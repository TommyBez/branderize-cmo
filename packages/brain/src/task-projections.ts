import {
  CONTENT_NOTION_PAGE_TASK_KIND,
  notionPagePayloadSchema,
  PRODUCT_MARKETER_TASK_KIND,
  type ProductMarketerCompletion,
  productMarketerCompletionSchema,
} from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import { actions, actors, tasks } from '@repo/db/schema/domain'
import { and, desc, eq, inArray } from 'drizzle-orm'

import type { TrustedMemberAccess } from './context'
import type { BrainTransaction } from './internal'
import { requireCurrentBrandMember } from './internal'

export const BRAND_TASK_STATUSES = [
  'awaiting_approval',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
  'outcome_unknown',
  'expired',
  'needs_regeneration',
  'dismissed',
] as const

export type BrandTaskStatus = (typeof BRAND_TASK_STATUSES)[number]

export const ACTIVE_WORK_STATUSES = ['queued', 'running'] as const

export const isActiveWorkStatus = (status: string): boolean =>
  status === 'queued' || status === 'running'

export type TaskCompletionProjection =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'valid'
      readonly value: ProductMarketerCompletion
    }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'summary'; readonly summary: string }

export interface TaskActionProvenanceProjection {
  readonly actorKey: string
  readonly createdAt: Date
  readonly id: string
  readonly rationale: string
  readonly type: string
}

export type ApprovalReviewProjection =
  | {
      readonly kind: typeof CONTENT_NOTION_PAGE_TASK_KIND
      readonly reportObjectId: string
      readonly title: string
    }
  | { readonly kind: 'generic'; readonly label: string }

export interface BrandTaskProjection {
  readonly activation: string
  readonly createdAt: Date
  readonly executionMode: string
  readonly finishedAt: Date | null
  readonly id: string
  readonly intentId: string | null
  readonly kind: string
  readonly revision: number
  readonly startedAt: Date | null
  readonly status: BrandTaskStatus
  readonly updatedAt: Date
  readonly workerKey: string
}

export interface BrandTaskDetailProjection extends BrandTaskProjection {
  readonly approval: TaskActionProvenanceProjection | null
  readonly completion: TaskCompletionProjection
  readonly questionResolution: {
    readonly actionId: string
    readonly resolvedAt: Date
  } | null
  readonly result: TaskActionProvenanceProjection | null
}

export interface ApprovalInboxItemProjection extends BrandTaskProjection {
  readonly review: ApprovalReviewProjection
}

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
  if (parsed.success) {
    return { kind: 'valid', value: parsed.data }
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'summary' in value &&
    typeof value.summary === 'string' &&
    value.summary.trim().length > 0
  ) {
    return { kind: 'summary', summary: value.summary }
  }
  return { kind: 'invalid' }
}

export const projectApprovalReview = ({
  kind,
  payload,
}: {
  readonly kind: string
  readonly payload: unknown
}): ApprovalReviewProjection => {
  if (kind === CONTENT_NOTION_PAGE_TASK_KIND) {
    const parsed = notionPagePayloadSchema.safeParse(payload)
    if (parsed.success) {
      return {
        kind: CONTENT_NOTION_PAGE_TASK_KIND,
        reportObjectId: parsed.data.reportObjectId,
        title: parsed.data.title,
      }
    }
  }
  return { kind: 'generic', label: kind }
}

const taskSelection = {
  activation: tasks.activation,
  completion: tasks.completion,
  createdAt: tasks.createdAt,
  executionMode: tasks.executionMode,
  finishedAt: tasks.finishedAt,
  id: tasks.id,
  intentId: tasks.intentId,
  kind: tasks.kind,
  revision: tasks.revision,
  startedAt: tasks.startedAt,
  status: tasks.status,
  updatedAt: tasks.updatedAt,
  workerKey: tasks.workerKey,
}

const brandTaskFromRow = (row: {
  readonly activation: string
  readonly createdAt: Date
  readonly executionMode: string
  readonly finishedAt: Date | null
  readonly id: string
  readonly intentId: string | null
  readonly kind: string
  readonly revision: number
  readonly startedAt: Date | null
  readonly status: BrandTaskStatus
  readonly updatedAt: Date
  readonly workerKey: string
}): BrandTaskProjection => ({
  activation: row.activation,
  createdAt: row.createdAt,
  executionMode: row.executionMode,
  finishedAt: row.finishedAt,
  id: row.id,
  intentId: row.intentId,
  kind: row.kind,
  revision: row.revision,
  startedAt: row.startedAt,
  status: row.status,
  updatedAt: row.updatedAt,
  workerKey: row.workerKey,
})

const projectActionProvenance = (row: {
  readonly actorKey: string | null
  readonly createdAt: Date | null
  readonly id: string | null
  readonly rationale: string | null
  readonly type: string | null
}): TaskActionProvenanceProjection | null => {
  if (
    row.actorKey === null ||
    row.createdAt === null ||
    row.id === null ||
    row.rationale === null ||
    row.type === null
  ) {
    return null
  }
  return {
    actorKey: row.actorKey,
    createdAt: row.createdAt,
    id: row.id,
    rationale: row.rationale,
    type: row.type,
  }
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

const clampPageLimit = (limit: number): number =>
  Math.min(Math.max(limit, 1), 100)

export const listBrandTasks = async ({
  access,
  database,
  limit = 50,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly limit?: number
}): Promise<readonly BrandTaskProjection[]> =>
  await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const rows = await transaction
      .select(taskSelection)
      .from(tasks)
      .where(eq(tasks.brandId, access.brandId))
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(clampPageLimit(limit))
    return rows.map((row) => brandTaskFromRow(row))
  })

export const listBrandApprovalInbox = async ({
  access,
  database,
  limit = 50,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly limit?: number
}): Promise<readonly ApprovalInboxItemProjection[]> =>
  await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const rows = await transaction
      .select({
        ...taskSelection,
        payload: tasks.payload,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.brandId, access.brandId),
          eq(tasks.activation, 'human'),
          eq(tasks.executionMode, 'direct'),
          eq(tasks.status, 'awaiting_approval')
        )
      )
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(clampPageLimit(limit))
    return rows.map((row) => ({
      ...brandTaskFromRow(row),
      review: projectApprovalReview({
        kind: row.kind,
        payload: row.payload,
      }),
    }))
  })

export const getBrandTask = async ({
  access,
  database,
  taskId,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly taskId: string
}): Promise<BrandTaskDetailProjection | null> =>
  await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const [row] = await transaction
      .select(taskSelection)
      .from(tasks)
      .where(and(eq(tasks.brandId, access.brandId), eq(tasks.id, taskId)))
      .limit(1)
    if (row === undefined) {
      return null
    }

    const provenanceRows = await transaction
      .select({
        actorKey: actors.actorKey,
        createdAt: actions.createdAt,
        id: actions.id,
        rationale: actions.rationale,
        type: actions.type,
      })
      .from(actions)
      .innerJoin(actors, eq(actors.id, actions.actorId))
      .where(
        and(
          eq(actions.brandId, access.brandId),
          eq(actions.taskId, taskId),
          inArray(actions.type, [
            'commitment_approved',
            'commitment_result',
            'task_questions_resolved',
          ])
        )
      )
      .orderBy(desc(actions.createdAt), desc(actions.id))

    let approval: TaskActionProvenanceProjection | null = null
    let result: TaskActionProvenanceProjection | null = null
    let questionResolution: BrandTaskDetailProjection['questionResolution'] =
      null
    for (const provenance of provenanceRows) {
      if (provenance.type === 'commitment_approved' && approval === null) {
        approval = projectActionProvenance(provenance)
      }
      if (provenance.type === 'commitment_result' && result === null) {
        result = projectActionProvenance(provenance)
      }
      if (
        provenance.type === 'task_questions_resolved' &&
        questionResolution === null
      ) {
        questionResolution = {
          actionId: provenance.id,
          resolvedAt: provenance.createdAt,
        }
      }
    }

    return {
      ...brandTaskFromRow(row),
      approval,
      completion: projectCompletion(row.completion),
      questionResolution,
      result,
    }
  })
