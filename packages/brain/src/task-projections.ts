import {
  PRODUCT_MARKETER_TASK_KIND,
  type ProductMarketerCompletion,
  productMarketerCompletionSchema,
} from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import { actions, tasks } from '@repo/db/schema/domain'
import { and, desc, eq } from 'drizzle-orm'

import type { TrustedMemberAccess } from './context'
import type { BrainTransaction } from './internal'
import { requireCurrentBrandMember } from './internal'

export type TaskCompletionProjection =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'valid'
      readonly value: ProductMarketerCompletion
    }
  | { readonly kind: 'invalid' }

export interface ProductMarketerTaskProjection {
  readonly completion: TaskCompletionProjection
  readonly createdAt: Date
  readonly finishedAt: Date | null
  readonly id: string
  readonly intentId: string | null
  readonly kind: string
  readonly startedAt: Date | null
  readonly status:
    | 'awaiting_approval'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'superseded'
    | 'outcome_unknown'
    | 'expired'
    | 'needs_regeneration'
    | 'dismissed'
  readonly updatedAt: Date
}

export interface ProductMarketerTaskDetailProjection
  extends ProductMarketerTaskProjection {
  readonly questionResolution: {
    readonly actionId: string
    readonly resolvedAt: Date
  } | null
}

interface ProductMarketerQuestionTaskCandidate {
  readonly completion: unknown
  readonly resolutionActionId: string | null
  readonly taskId: string
}

const projectCompletion = (value: unknown): TaskCompletionProjection => {
  if (value === null) {
    return { kind: 'none' }
  }
  const parsed = productMarketerCompletionSchema.safeParse(value)
  return parsed.success
    ? { kind: 'valid', value: parsed.data }
    : { kind: 'invalid' }
}

const taskSelection = {
  completion: tasks.completion,
  createdAt: tasks.createdAt,
  finishedAt: tasks.finishedAt,
  id: tasks.id,
  intentId: tasks.intentId,
  kind: tasks.kind,
  startedAt: tasks.startedAt,
  status: tasks.status,
  updatedAt: tasks.updatedAt,
}

export const listProductMarketerTasks = async ({
  access,
  database,
  limit = 30,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly limit?: number
}): Promise<readonly ProductMarketerTaskProjection[]> =>
  await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const rows = await transaction
      .select(taskSelection)
      .from(tasks)
      .where(
        and(
          eq(tasks.brandId, access.brandId),
          eq(tasks.kind, PRODUCT_MARKETER_TASK_KIND)
        )
      )
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(Math.min(Math.max(limit, 1), 100))

    return rows.map((row) => ({
      ...row,
      completion: projectCompletion(row.completion),
    }))
  })

export const getProductMarketerTask = async ({
  access,
  database,
  taskId,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly taskId: string
}): Promise<ProductMarketerTaskDetailProjection | null> =>
  await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const [row] = await transaction
      .select({
        ...taskSelection,
        resolutionActionId: actions.id,
        resolvedAt: actions.createdAt,
      })
      .from(tasks)
      .leftJoin(
        actions,
        and(
          eq(actions.brandId, tasks.brandId),
          eq(actions.taskId, tasks.id),
          eq(actions.type, 'task_questions_resolved')
        )
      )
      .where(
        and(
          eq(tasks.brandId, access.brandId),
          eq(tasks.id, taskId),
          eq(tasks.kind, PRODUCT_MARKETER_TASK_KIND)
        )
      )
      .limit(1)

    if (row === undefined) {
      return null
    }

    const { resolutionActionId, resolvedAt, ...task } = row
    const questionResolution =
      resolutionActionId === null || resolvedAt === null
        ? null
        : {
            actionId: resolutionActionId,
            resolvedAt,
          }
    return {
      ...task,
      completion: projectCompletion(task.completion),
      questionResolution,
    }
  })

const loadProductMarketerQuestionTaskCandidate = async ({
  brandId,
  sourceTaskId,
  transaction,
}: {
  readonly brandId: string
  readonly sourceTaskId: string
  readonly transaction: BrainTransaction
}): Promise<ProductMarketerQuestionTaskCandidate | null> => {
  const [candidate] = await transaction
    .select({
      completion: tasks.completion,
      resolutionActionId: actions.id,
      taskId: tasks.id,
    })
    .from(tasks)
    .leftJoin(
      actions,
      and(
        eq(actions.brandId, tasks.brandId),
        eq(actions.taskId, tasks.id),
        eq(actions.type, 'task_questions_resolved')
      )
    )
    .where(
      and(
        eq(tasks.id, sourceTaskId),
        eq(tasks.brandId, brandId),
        eq(tasks.kind, PRODUCT_MARKETER_TASK_KIND),
        eq(tasks.status, 'succeeded')
      )
    )
    .limit(1)

  if (candidate === undefined) {
    return null
  }
  const completion = productMarketerCompletionSchema.safeParse(
    candidate.completion
  )
  return completion.success && completion.data.status !== 'completed'
    ? candidate
    : null
}

export const getProductMarketerQuestionTaskIdForResolution = async ({
  access,
  database,
  sourceTaskId,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly sourceTaskId: string
}): Promise<string | null> =>
  await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const candidate = await loadProductMarketerQuestionTaskCandidate({
      brandId: access.brandId,
      sourceTaskId,
      transaction,
    })
    return candidate === null ? null : candidate.taskId
  })

export const getOpenProductMarketerQuestionTaskId = async ({
  access,
  database,
  sourceTaskId,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly sourceTaskId: string
}): Promise<string | null> =>
  await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const candidate = await loadProductMarketerQuestionTaskCandidate({
      brandId: access.brandId,
      sourceTaskId,
      transaction,
    })
    if (candidate === null || candidate.resolutionActionId !== null) {
      return null
    }
    return candidate.taskId
  })
