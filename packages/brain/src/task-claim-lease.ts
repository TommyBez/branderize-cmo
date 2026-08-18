import {
  type AgentKey,
  getAgent,
  getTaskKind,
  type RegisteredTaskKindKey,
  registeredTaskKindKeySchema,
} from '@repo/agents'
import { productMarketerPayloadSchema } from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import { actors, objects, tasks } from '@repo/db/schema/domain'
import { and, eq, isNull, lte, sql } from 'drizzle-orm'

import type { TrustedTaskExecution } from './context'
import { fail } from './errors'
import type { BrainTransaction } from './internal'
import { requireTrustedAgentActor } from './internal'
import { BRAND_CONTEXT_SINGLETON_KEY } from './objects'
import {
  type ClaimedProductMarketerTask,
  type ClaimedRegisteredAgentTask,
  PRODUCT_MARKETER_TASK_KIND,
  PRODUCT_MARKETER_WORKER_KEY,
  type ProductMarketerDeliveryFailure,
  type RegisteredTaskDeliveryClaim,
  type RegisteredTaskDeliveryFailure,
  type TaskIntentSnapshot,
  taskExecutionGenerationMatches,
  taskIntentSnapshotSchema,
} from './task-contracts'

export const AGENT_DELIVERY_RECOVERY_WINDOW_MS = 5 * 60 * 1000

const DELIVERY_FAILED_OUTCOME_CODE = 'DELIVERY_FAILED' as const

export interface RegisteredTaskClaimAdapterInput<
  TKind extends RegisteredTaskKindKey = RegisteredTaskKindKey,
> {
  readonly brandId: string
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: TKind
  readonly payload: unknown
  readonly taskId: string
  readonly transaction: BrainTransaction
  readonly workerKey: AgentKey
}

export type RegisteredTaskClaimAdapter<
  TKind extends RegisteredTaskKindKey,
  TAdapterContext,
> = (input: RegisteredTaskClaimAdapterInput<TKind>) => Promise<TAdapterContext>

export const claimRegisteredAgentTask = async <
  TKind extends RegisteredTaskKindKey,
  TAdapterContext,
>({
  database,
  kind,
  now,
  prepareAdapterContext,
}: {
  readonly database: Database
  readonly kind: TKind
  readonly now: Date
  readonly prepareAdapterContext: RegisteredTaskClaimAdapter<
    TKind,
    TAdapterContext
  >
}): Promise<ClaimedRegisteredAgentTask<TKind, TAdapterContext> | null> => {
  const taskKind = getTaskKind(kind)
  const registeredAgent = getAgent(taskKind.workerKey)

  return await database.transaction(async (transaction) => {
    const recoveryCutoff = new Date(
      now.getTime() - AGENT_DELIVERY_RECOVERY_WINDOW_MS
    )
    await transaction
      .update(tasks)
      .set({
        completion: null,
        nextDueAt: null,
        nextPayload: null,
        nextRationale: null,
        startedAt: null,
        status: 'queued',
      })
      .where(
        and(
          eq(tasks.executionMode, taskKind.executionMode),
          eq(tasks.activation, taskKind.activation),
          eq(tasks.workerKey, taskKind.workerKey),
          eq(tasks.kind, taskKind.kind),
          eq(tasks.status, 'running'),
          isNull(tasks.sessionId),
          lte(tasks.startedAt, recoveryCutoff)
        )
      )

    const [task] = await transaction
      .select({
        brandId: tasks.brandId,
        id: tasks.id,
        intentSnapshot: tasks.intentSnapshot,
        kind: tasks.kind,
        payload: tasks.payload,
        workerKey: tasks.workerKey,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.executionMode, taskKind.executionMode),
          eq(tasks.activation, taskKind.activation),
          eq(tasks.workerKey, taskKind.workerKey),
          eq(tasks.kind, taskKind.kind),
          eq(tasks.status, 'queued'),
          isNull(tasks.sessionId),
          lte(tasks.dueAt, now),
          sql`(SELECT coalesce(sum(cl.amount), 0) FROM credit_ledger AS cl WHERE cl.brand_id = ${tasks.brandId}) > 0`
        )
      )
      .orderBy(tasks.createdAt, tasks.id)
      .for('update', { skipLocked: true })
      .limit(1)
    if (task === undefined) {
      return null
    }

    const intentSnapshot = taskIntentSnapshotSchema.safeParse(
      task.intentSnapshot
    )
    const payload = taskKind.briefSchema.safeParse(task.payload)
    const bindingMatches =
      task.kind === taskKind.kind && task.workerKey === taskKind.workerKey
    if (!(intentSnapshot.success && payload.success && bindingMatches)) {
      return fail('invalid_task', 'Queued registered Agent task is malformed')
    }
    const [agentActor] = await transaction
      .select({ actorKey: actors.actorKey, id: actors.id, type: actors.type })
      .from(actors)
      .where(eq(actors.actorKey, registeredAgent.actorKey))
      .for('share')
      .limit(1)
    if (
      agentActor === undefined ||
      agentActor.type !== 'agent' ||
      agentActor.actorKey !== registeredAgent.actorKey
    ) {
      return fail('invalid_task', 'Registered task has no trusted Agent Actor')
    }

    const adapterContext = await prepareAdapterContext({
      brandId: task.brandId,
      intentSnapshot: intentSnapshot.data,
      kind,
      payload: payload.data,
      taskId: task.id,
      transaction,
      workerKey: taskKind.workerKey,
    })
    const [claimed] = await transaction
      .update(tasks)
      .set({
        startedAt: now,
        status: 'running',
      })
      .where(
        and(
          eq(tasks.id, task.id),
          eq(tasks.brandId, task.brandId),
          eq(tasks.kind, taskKind.kind),
          eq(tasks.workerKey, taskKind.workerKey),
          eq(tasks.status, 'queued')
        )
      )
      .returning({ id: tasks.id, startedAt: tasks.startedAt })
    if (claimed === undefined) {
      return fail('already_claimed', 'Task claim lost its queue race')
    }
    if (claimed.startedAt === null) {
      return fail('invalid_task', 'Claimed task has no execution generation')
    }

    return {
      adapterContext,
      agentActorId: agentActor.id,
      agentActorKey: registeredAgent.actorKey,
      brandId: task.brandId,
      intentSnapshot: intentSnapshot.data,
      kind,
      payload: payload.data,
      startedAt: claimed.startedAt,
      taskId: task.id,
      workerKey: taskKind.workerKey,
    }
  })
}

export interface ProductMarketerClaimAdapterContext {
  readonly brandContextContent: unknown
  readonly brandContextObjectId: string
}

export const prepareProductMarketerClaim: RegisteredTaskClaimAdapter<
  typeof PRODUCT_MARKETER_TASK_KIND,
  ProductMarketerClaimAdapterContext
> = async ({ brandId, transaction }) => {
  const [brandContext] = await transaction
    .select({ content: objects.content, id: objects.id })
    .from(objects)
    .where(
      and(
        eq(objects.brandId, brandId),
        eq(objects.singletonKey, BRAND_CONTEXT_SINGLETON_KEY),
        eq(objects.status, 'active')
      )
    )
    .for('share')
    .limit(1)
  if (brandContext === undefined) {
    return fail('invalid_task', 'Product Marketer task has no Brand Context')
  }
  return {
    brandContextContent: brandContext.content,
    brandContextObjectId: brandContext.id,
  }
}

export const adaptProductMarketerClaim = (
  claim: ClaimedRegisteredAgentTask<
    typeof PRODUCT_MARKETER_TASK_KIND,
    ProductMarketerClaimAdapterContext
  >
): ClaimedProductMarketerTask => {
  const registeredAgent = getAgent(PRODUCT_MARKETER_WORKER_KEY)
  if (
    claim.workerKey !== PRODUCT_MARKETER_WORKER_KEY ||
    claim.agentActorKey !== registeredAgent.actorKey
  ) {
    return fail('invalid_task', 'Product Marketer claim binding is invalid')
  }
  return {
    agentActorId: claim.agentActorId,
    agentActorKey: registeredAgent.actorKey,
    brandContextContent: claim.adapterContext.brandContextContent,
    brandContextObjectId: claim.adapterContext.brandContextObjectId,
    brandId: claim.brandId,
    intentSnapshot: claim.intentSnapshot,
    kind: PRODUCT_MARKETER_TASK_KIND,
    payload: productMarketerPayloadSchema.parse(claim.payload),
    startedAt: claim.startedAt,
    taskId: claim.taskId,
    workerKey: PRODUCT_MARKETER_WORKER_KEY,
  }
}

export const claimProductMarketerTask = async ({
  database,
  now,
}: {
  readonly database: Database
  readonly now: Date
}): Promise<ClaimedProductMarketerTask | null> => {
  const claim = await claimRegisteredAgentTask({
    database,
    kind: PRODUCT_MARKETER_TASK_KIND,
    now,
    prepareAdapterContext: prepareProductMarketerClaim,
  })
  if (claim === null) {
    return null
  }
  return adaptProductMarketerClaim(claim)
}

export const failRegisteredAgentDelivery = async ({
  claim,
  database,
  now,
}: {
  readonly claim: RegisteredTaskDeliveryClaim
  readonly database: Database
  readonly now: Date
}): Promise<RegisteredTaskDeliveryFailure> => {
  const registeredKind = registeredTaskKindKeySchema.safeParse(claim.kind)
  if (!registeredKind.success) {
    return fail('invalid_task', 'Delivery failure kind is not registered')
  }
  const taskKind = getTaskKind(registeredKind.data)
  const registeredAgent = getAgent(taskKind.workerKey)
  if (
    claim.workerKey !== taskKind.workerKey ||
    claim.agentActorKey !== registeredAgent.actorKey
  ) {
    return fail('invalid_task', 'Delivery failure binding is invalid')
  }

  return await database.transaction(async (transaction) => {
    await requireTrustedAgentActor(transaction, {
      actorId: claim.agentActorId,
      actorKey: claim.agentActorKey,
    })
    const [task] = await transaction
      .select({
        kind: tasks.kind,
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
        status: tasks.status,
        workerKey: tasks.workerKey,
      })
      .from(tasks)
      .where(and(eq(tasks.id, claim.taskId), eq(tasks.brandId, claim.brandId)))
      .for('update')
      .limit(1)
    if (task === undefined) {
      return fail('task_not_found', 'Delivery failure target is missing')
    }
    if (task.kind !== taskKind.kind || task.workerKey !== taskKind.workerKey) {
      return fail('invalid_task', 'Delivery failure binding is invalid')
    }
    if (
      task.status !== 'running' ||
      task.sessionId !== null ||
      !taskExecutionGenerationMatches(task.startedAt, claim.startedAt)
    ) {
      return {
        outcome: 'not_unbound_running',
        taskId: claim.taskId,
      }
    }

    const [failed] = await transaction
      .update(tasks)
      .set({
        completion: null,
        finishedAt: now,
        nextDueAt: null,
        nextPayload: null,
        nextRationale: null,
        outcomeCode: DELIVERY_FAILED_OUTCOME_CODE,
        status: 'failed',
      })
      .where(
        and(
          eq(tasks.id, claim.taskId),
          eq(tasks.brandId, claim.brandId),
          eq(tasks.workerKey, taskKind.workerKey),
          eq(tasks.kind, taskKind.kind),
          eq(tasks.status, 'running'),
          eq(tasks.startedAt, claim.startedAt),
          isNull(tasks.sessionId)
        )
      )
      .returning({ id: tasks.id })
    if (failed === undefined) {
      return {
        outcome: 'not_unbound_running',
        taskId: claim.taskId,
      }
    }
    return {
      outcome: 'delivery_failed',
      taskId: failed.id,
    }
  })
}

export const failProductMarketerDelivery = async ({
  claim,
  database,
  now,
}: {
  readonly claim: ClaimedProductMarketerTask
  readonly database: Database
  readonly now: Date
}): Promise<ProductMarketerDeliveryFailure> =>
  await failRegisteredAgentDelivery({ claim, database, now })

export const bindTaskSession = async ({
  database,
  execution,
}: {
  readonly database: Database
  readonly execution: TrustedTaskExecution
}): Promise<void> => {
  await database.transaction(async (transaction) => {
    const [task] = await transaction
      .select({
        kind: tasks.kind,
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
        status: tasks.status,
        workerKey: tasks.workerKey,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId)
        )
      )
      .for('update')
      .limit(1)
    if (task === undefined) {
      return fail('task_not_found', 'Task session binding target is missing')
    }
    const registeredKind = registeredTaskKindKeySchema.safeParse(task.kind)
    if (!registeredKind.success) {
      return fail('invalid_task', 'Task session binding kind is not registered')
    }
    const taskKind = getTaskKind(registeredKind.data)
    const registeredAgent = getAgent(taskKind.workerKey)
    const bindingMatches =
      task.workerKey === taskKind.workerKey &&
      execution.workerKey === taskKind.workerKey &&
      execution.agentActorKey === registeredAgent.actorKey
    if (!bindingMatches) {
      return fail('invalid_task', 'Task session binding is invalid')
    }
    await requireTrustedAgentActor(transaction, {
      actorId: execution.agentActorId,
      actorKey: execution.agentActorKey,
    })
    if (!taskExecutionGenerationMatches(task.startedAt, execution.startedAt)) {
      return fail('already_claimed', 'Task execution generation is stale')
    }
    if (task.sessionId === execution.sessionId) {
      return
    }
    if (task.status !== 'running' || task.sessionId !== null) {
      return fail(
        'already_claimed',
        'Task already has an authoritative session'
      )
    }
    const [bound] = await transaction
      .update(tasks)
      .set({ sessionId: execution.sessionId })
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId),
          eq(tasks.kind, taskKind.kind),
          eq(tasks.workerKey, taskKind.workerKey),
          eq(tasks.status, 'running'),
          eq(tasks.startedAt, execution.startedAt),
          isNull(tasks.sessionId)
        )
      )
      .returning({ id: tasks.id })
    if (bound === undefined) {
      return fail('already_claimed', 'Task session binding lost its race')
    }
  })
}
