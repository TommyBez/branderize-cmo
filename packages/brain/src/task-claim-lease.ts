import {
  type AgentKey,
  getAgent,
  getTaskKind,
  type RegisteredTaskKindKey,
  registeredTaskKindKeySchema,
} from '@repo/agents'
import { taskIntentSnapshotSchema } from '@repo/agents/task-snapshot'
import type { Database } from '@repo/db/client'
import { actors, tasks } from '@repo/db/schema/domain'
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm'

import type { TrustedTaskExecution } from './context'
import { fail } from './errors'
import { requireTrustedAgentActor } from './internal'
import { claimContextAdapters } from './task-claim-adapters'
import {
  type ClaimedTask,
  type RegisteredTaskDeliveryClaim,
  type RegisteredTaskDeliveryFailure,
  taskExecutionGenerationMatches,
  taskGenerationOf,
} from './task-contracts'

export const AGENT_DELIVERY_RECOVERY_WINDOW_MS = 5 * 60 * 1000

const DELIVERY_FAILED_OUTCOME_CODE = 'DELIVERY_FAILED' as const

export const claimNextDueWorkerTask = async ({
  database,
  kinds,
  now,
  workerKey,
}: {
  readonly database: Database
  readonly kinds: readonly [RegisteredTaskKindKey, ...RegisteredTaskKindKey[]]
  readonly now: Date
  readonly workerKey: AgentKey
}): Promise<ClaimedTask | null> => {
  const registeredAgent = getAgent(workerKey)
  const kindList = [...kinds]

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
          eq(tasks.executionMode, 'agent'),
          eq(tasks.activation, 'automatic'),
          eq(tasks.workerKey, workerKey),
          inArray(tasks.kind, kindList),
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
          eq(tasks.executionMode, 'agent'),
          eq(tasks.activation, 'automatic'),
          eq(tasks.workerKey, workerKey),
          inArray(tasks.kind, kindList),
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

    const registeredKind = registeredTaskKindKeySchema.safeParse(task.kind)
    if (
      !(
        registeredKind.success &&
        kinds.includes(registeredKind.data) &&
        task.workerKey === workerKey
      )
    ) {
      return fail('invalid_task', 'Queued registered Agent task is malformed')
    }

    const kind = registeredKind.data
    const taskKind = getTaskKind(kind)
    if (taskKind.workerKey !== workerKey) {
      return fail('invalid_task', 'Queued registered Agent task is malformed')
    }

    const intentSnapshot = taskIntentSnapshotSchema.safeParse(
      task.intentSnapshot
    )
    const payload = taskKind.briefSchema.safeParse(task.payload)
    if (!(intentSnapshot.success && payload.success)) {
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

    const claimContext = taskKind.claimContextSchema.parse(
      await claimContextAdapters[kind]({
        brandId: task.brandId,
        intentSnapshot: intentSnapshot.data,
        kind,
        payload: payload.data,
        taskId: task.id,
        transaction,
        workerKey,
      })
    )
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
          eq(tasks.kind, kind),
          eq(tasks.workerKey, workerKey),
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
      agentActorId: agentActor.id,
      agentActorKey: registeredAgent.actorKey,
      brandId: task.brandId,
      claimContext,
      intentSnapshot: intentSnapshot.data,
      kind,
      payload: payload.data,
      startedAt: taskGenerationOf(claimed.startedAt),
      taskId: task.id,
      workerKey,
    }
  })
}

export const claimRegisteredAgentTask = async <
  TKind extends RegisteredTaskKindKey,
>({
  database,
  kind,
  now,
}: {
  readonly database: Database
  readonly kind: TKind
  readonly now: Date
}): Promise<ClaimedTask<TKind> | null> => {
  const taskKind = getTaskKind(kind)
  return (await claimNextDueWorkerTask({
    database,
    kinds: [kind],
    now,
    workerKey: taskKind.workerKey,
  })) as ClaimedTask<TKind> | null
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
