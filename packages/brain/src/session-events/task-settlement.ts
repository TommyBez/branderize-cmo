import { getTaskKind, registeredTaskKindKeySchema } from '@repo/agents'
import { tasks } from '@repo/db/schema/domain'
import { and, eq, isNull, or } from 'drizzle-orm'

import { fail } from '../errors'
import type { BrainTransaction } from '../internal'

export type TaskSettlement =
  | { readonly kind: 'not_applicable' }
  | {
      readonly kind: 'already_terminal'
      readonly status: 'cancelled' | 'failed' | 'succeeded' | 'superseded'
      readonly taskId: string
    }
  | {
      readonly kind: 'failed'
      readonly reason:
        | 'invalid_completion'
        | 'missing_completion'
        | 'session_failed'
        | 'turn_failed'
      readonly taskId: string
    }
  | {
      readonly kind: 'cancelled'
      readonly reason: 'turn_cancelled'
      readonly taskId: string
    }
  | {
      readonly kind: 'not_running'
      readonly status: 'awaiting_approval' | 'queued'
      readonly taskId: string
    }
  | { readonly kind: 'succeeded'; readonly taskId: string }

interface PersistedTaskRegistryBinding {
  readonly activation: string
  readonly executionMode: string
  readonly kind: string
  readonly payload: unknown
  readonly subjectKey: string | null
  readonly workerKey: string | null
}

export const resolveRegisteredTaskKindForSettlement = (
  task: PersistedTaskRegistryBinding
) => {
  const registeredKind = registeredTaskKindKeySchema.safeParse(task.kind)
  if (!registeredKind.success) {
    return fail('invalid_event', 'Terminal event task kind is not registered')
  }
  const taskKind = getTaskKind(registeredKind.data)
  const payload = taskKind.briefSchema.safeParse(task.payload)
  const bindingMatches =
    task.activation === taskKind.activation &&
    task.executionMode === taskKind.executionMode &&
    task.workerKey === taskKind.workerKey &&
    payload.success &&
    task.subjectKey === taskKind.subjectKey(payload.data)
  if (!bindingMatches) {
    return fail(
      'invalid_event',
      'Terminal event task registry binding is invalid'
    )
  }
  return taskKind
}

const attachTerminalTaskSession = async ({
  brandId,
  sessionId,
  taskId,
  transaction,
}: {
  readonly brandId: string
  readonly sessionId: string
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<void> => {
  await transaction
    .update(tasks)
    .set({ sessionId })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.brandId, brandId),
        isNull(tasks.sessionId)
      )
    )
}

export const settleTaskFromRootCompletion = async ({
  brandId,
  occurredAt,
  sessionId,
  taskId,
  transaction,
}: {
  readonly brandId: string
  readonly occurredAt: Date
  readonly sessionId: string
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<TaskSettlement> => {
  const [task] = await transaction
    .select({
      activation: tasks.activation,
      completion: tasks.completion,
      executionMode: tasks.executionMode,
      kind: tasks.kind,
      payload: tasks.payload,
      sessionId: tasks.sessionId,
      status: tasks.status,
      subjectKey: tasks.subjectKey,
      workerKey: tasks.workerKey,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.brandId, brandId)))
    .for('update')
    .limit(1)
  if (task === undefined) {
    return fail('invalid_event', 'Terminal event task binding is invalid')
  }
  if (task.sessionId !== null && task.sessionId !== sessionId) {
    return fail(
      'invalid_event',
      'Only the authoritative task session can settle the task'
    )
  }
  const taskKind = resolveRegisteredTaskKindForSettlement(task)

  if (
    task.status === 'succeeded' ||
    task.status === 'failed' ||
    task.status === 'cancelled' ||
    task.status === 'superseded'
  ) {
    if (task.sessionId === null && task.status !== 'superseded') {
      await attachTerminalTaskSession({
        brandId,
        sessionId,
        taskId,
        transaction,
      })
    }
    return { kind: 'already_terminal', status: task.status, taskId }
  }
  if (task.status === 'queued' || task.status === 'awaiting_approval') {
    return { kind: 'not_running', status: task.status, taskId }
  }
  if (task.status !== 'running') {
    return fail('invalid_event', 'Agent task has an invalid settlement status')
  }

  const completion = taskKind.completionSchema.safeParse(task.completion)
  if (completion.success) {
    const [settled] = await transaction
      .update(tasks)
      .set({
        finishedAt: occurredAt,
        leasedUntil: null,
        nextDueAt: null,
        nextPayload: null,
        nextRationale: null,
        outcomeCode: completion.data.status,
        sessionId,
        status: 'succeeded',
      })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.brandId, brandId),
          eq(tasks.status, 'running'),
          or(isNull(tasks.sessionId), eq(tasks.sessionId, sessionId))
        )
      )
      .returning({ id: tasks.id })
    if (settled === undefined) {
      return fail('invalid_event', 'Task success settlement lost its race')
    }
    return { kind: 'succeeded', taskId }
  }

  const reason =
    task.completion === null ? 'missing_completion' : 'invalid_completion'
  const [settled] = await transaction
    .update(tasks)
    .set({
      completion: null,
      finishedAt: occurredAt,
      leasedUntil: null,
      nextDueAt: null,
      nextPayload: null,
      nextRationale: null,
      outcomeCode:
        reason === 'missing_completion'
          ? 'MISSING_TASK_COMPLETION'
          : 'INVALID_TASK_COMPLETION',
      sessionId,
      status: 'failed',
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.brandId, brandId),
        eq(tasks.status, 'running'),
        or(isNull(tasks.sessionId), eq(tasks.sessionId, sessionId))
      )
    )
    .returning({ id: tasks.id })
  if (settled === undefined) {
    return fail('invalid_event', 'Task failure settlement lost its race')
  }
  return { kind: 'failed', reason, taskId }
}

export type RootTaskAbort = 'session_failed' | 'turn_cancelled' | 'turn_failed'

export const rootTaskAbortFromEventType = (
  eventType: string
): RootTaskAbort => {
  if (eventType === 'turn.cancelled') {
    return 'turn_cancelled'
  }
  if (eventType === 'turn.failed') {
    return 'turn_failed'
  }
  return 'session_failed'
}

const taskAbortOutcomeCode = (abort: RootTaskAbort): string => {
  if (abort === 'session_failed') {
    return 'SESSION_FAILED'
  }
  if (abort === 'turn_failed') {
    return 'TURN_FAILED'
  }
  return 'TURN_CANCELLED'
}

export const settleTaskFromRootAbort = async ({
  abort,
  brandId,
  occurredAt,
  sessionId,
  taskId,
  transaction,
}: {
  readonly abort: RootTaskAbort
  readonly brandId: string
  readonly occurredAt: Date
  readonly sessionId: string
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<TaskSettlement> => {
  const [task] = await transaction
    .select({
      activation: tasks.activation,
      executionMode: tasks.executionMode,
      kind: tasks.kind,
      payload: tasks.payload,
      sessionId: tasks.sessionId,
      status: tasks.status,
      subjectKey: tasks.subjectKey,
      workerKey: tasks.workerKey,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.brandId, brandId)))
    .for('update')
    .limit(1)
  if (task === undefined) {
    return fail('invalid_event', 'Terminal event task binding is invalid')
  }
  if (task.sessionId !== null && task.sessionId !== sessionId) {
    return fail(
      'invalid_event',
      'Only the authoritative task session can fail the task'
    )
  }
  resolveRegisteredTaskKindForSettlement(task)
  if (
    task.status === 'succeeded' ||
    task.status === 'failed' ||
    task.status === 'cancelled' ||
    task.status === 'superseded'
  ) {
    if (task.sessionId === null && task.status !== 'superseded') {
      await attachTerminalTaskSession({
        brandId,
        sessionId,
        taskId,
        transaction,
      })
    }
    return { kind: 'already_terminal', status: task.status, taskId }
  }
  if (task.status === 'queued' || task.status === 'awaiting_approval') {
    return { kind: 'not_running', status: task.status, taskId }
  }
  if (task.status !== 'running') {
    return fail('invalid_event', 'Agent task has an invalid settlement status')
  }

  const [settled] = await transaction
    .update(tasks)
    .set({
      completion: null,
      finishedAt: occurredAt,
      leasedUntil: null,
      nextDueAt: null,
      nextPayload: null,
      nextRationale: null,
      outcomeCode: taskAbortOutcomeCode(abort),
      sessionId,
      status: abort === 'turn_cancelled' ? 'cancelled' : 'failed',
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.brandId, brandId),
        eq(tasks.status, 'running'),
        or(isNull(tasks.sessionId), eq(tasks.sessionId, sessionId))
      )
    )
    .returning({ id: tasks.id })
  if (settled === undefined) {
    return fail('invalid_event', 'Task failure settlement lost its race')
  }
  if (abort === 'turn_cancelled') {
    return { kind: 'cancelled', reason: abort, taskId }
  }
  return { kind: 'failed', reason: abort, taskId }
}
