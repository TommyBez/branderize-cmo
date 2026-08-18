import { productMarketerCompletionSchema } from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import {
  cmoConversations,
  creditLedger,
  sessionEvents,
  tasks,
} from '@repo/db/schema/domain'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'

import { canonicalize } from './canonical'
import { fail } from './errors'
import type { BrainTransaction } from './internal'

const MAX_POSTGRES_INTEGER = 2_147_483_647
const MAX_LEDGER_COST_USD = 999_999_999_999
const PHASE_ZERO_PRODUCT_MARKETER_KIND =
  'product-marketer.brand-context.v1' as const

const nonBlankIdentifierSchema = z.string().trim().min(1).max(500)
const eventMetaSchema = z
  .object({
    at: z.iso.datetime({ offset: true }),
    id: nonBlankIdentifierSchema,
  })
  .catchall(z.json())

export const sessionEventEnvelopeSchema = z
  .object({
    meta: eventMetaSchema,
    type: nonBlankIdentifierSchema,
  })
  .catchall(z.json())

const rootSessionSchema = z
  .object({
    kind: z.literal('root'),
    sessionId: nonBlankIdentifierSchema,
  })
  .strict()

const childSessionSchema = z
  .object({
    kind: z.literal('child'),
    parentCallId: nonBlankIdentifierSchema,
    parentSessionId: nonBlankIdentifierSchema,
    rootSessionId: nonBlankIdentifierSchema,
    sessionId: nonBlankIdentifierSchema,
  })
  .strict()
  .superRefine((session, context) => {
    if (session.sessionId === session.parentSessionId) {
      context.addIssue({
        code: 'custom',
        message: 'A child session cannot be its own immediate parent',
        path: ['parentSessionId'],
      })
    }
    if (session.sessionId === session.rootSessionId) {
      context.addIssue({
        code: 'custom',
        message: 'A child session cannot be its own root',
        path: ['rootSessionId'],
      })
    }
  })

const sessionOwnerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      conversationId: z.uuid(),
      kind: z.literal('conversation'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('task'),
      startedAt: z.date(),
      taskId: z.uuid(),
    })
    .strict(),
])

export const sessionEventIngestionSchema = z
  .object({
    auth: z
      .object({
        currentBrandId: z.uuid(),
        initiatingBrandId: z.uuid(),
      })
      .strict(),
    event: sessionEventEnvelopeSchema,
    owner: sessionOwnerSchema,
    session: z.discriminatedUnion('kind', [
      rootSessionSchema,
      childSessionSchema,
    ]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.auth.currentBrandId !== input.auth.initiatingBrandId) {
      context.addIssue({
        code: 'custom',
        message: 'Current and initiating session brands must match',
        path: ['auth', 'currentBrandId'],
      })
    }
  })

const usageSchema = z
  .object({
    cacheReadTokens: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_POSTGRES_INTEGER)
      .optional(),
    cacheWriteTokens: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_POSTGRES_INTEGER)
      .optional(),
    costUsd: z
      .number()
      .finite()
      .nonnegative()
      .max(MAX_LEDGER_COST_USD)
      .optional(),
    inputTokens: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_POSTGRES_INTEGER)
      .optional(),
    outputTokens: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_POSTGRES_INTEGER)
      .optional(),
  })
  .catchall(z.json())

const stepCompletedEventSchema = sessionEventEnvelopeSchema.extend({
  data: z
    .object({
      finishReason: nonBlankIdentifierSchema,
      providerMetadata: z
        .object({
          gateway: z
            .object({ generationId: nonBlankIdentifierSchema })
            .catchall(z.json()),
        })
        .catchall(z.json())
        .optional(),
      sequence: z.number().int().nonnegative(),
      stepIndex: z.number().int().nonnegative(),
      turnId: nonBlankIdentifierSchema,
      usage: usageSchema.optional(),
    })
    .catchall(z.json()),
  type: z.literal('step.completed'),
})

const stepCoordinateEventSchema = sessionEventEnvelopeSchema.extend({
  data: z
    .object({
      sequence: z.number().int().nonnegative(),
      stepIndex: z.number().int().nonnegative(),
      turnId: nonBlankIdentifierSchema,
    })
    .catchall(z.json()),
  type: z.literal('step.completed'),
})

const sessionStartedEventSchema = sessionEventEnvelopeSchema.extend({
  data: z
    .object({
      runtime: z
        .object({ modelId: nonBlankIdentifierSchema })
        .catchall(z.json())
        .optional(),
    })
    .catchall(z.json()),
  type: z.literal('session.started'),
})

export type SessionEventEnvelope = z.infer<typeof sessionEventEnvelopeSchema>
export type SessionEventIngestion = z.input<typeof sessionEventIngestionSchema>

export const parsePersistableSessionEvent = (
  value: unknown
): SessionEventEnvelope => {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('A session event must have a JSON object envelope')
  }
  const normalized: unknown = JSON.parse(serialized)
  return sessionEventEnvelopeSchema.parse(normalized)
}

export interface PersistedEventProjectionRow {
  readonly conversationId: string | null
  readonly event: unknown
  readonly eventKind: string
  readonly ingestionSequence: number
  readonly metaId: string
  readonly sessionId: string
  readonly taskId: string | null
}

type SkippedChargeReason =
  | 'cost_below_ledger_precision'
  | 'invalid_step_event'
  | 'missing_reported_cost'
  | 'missing_reported_model'
  | 'missing_reported_tokens'
  | 'zero_reported_cost'

export interface ModelChargeCandidate {
  readonly amount: string
  readonly cacheReadTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly conversationId: string | null
  readonly finishReason: string
  readonly gatewayCostUsd: string
  readonly generationId: string | null
  readonly ingestionSequence: number
  readonly inputTokens: number
  readonly kind: 'charge'
  readonly modelId: string
  readonly outputTokens: number
  readonly sequence: number
  readonly sessionEventId: string
  readonly sessionId: string
  readonly stepIndex: number
  readonly taskId: string | null
  readonly turnId: string
}

export interface SkippedModelCharge {
  readonly ingestionSequence: number
  readonly kind: 'skipped'
  readonly reason: SkippedChargeReason
  readonly sessionEventId: string
}

export type ModelChargeDecision = ModelChargeCandidate | SkippedModelCharge

interface WinningStep {
  readonly event: z.infer<typeof stepCoordinateEventSchema>
  readonly row: PersistedEventProjectionRow
}

const skippedCharge = (
  row: PersistedEventProjectionRow,
  reason: SkippedChargeReason
): SkippedModelCharge => ({
  ingestionSequence: row.ingestionSequence,
  kind: 'skipped',
  reason,
  sessionEventId: row.metaId,
})

const chargeCoordinate = (
  row: PersistedEventProjectionRow,
  event: z.infer<typeof stepCoordinateEventSchema>
): string =>
  canonicalize({
    sequence: event.data.sequence,
    sessionId: row.sessionId,
    stepIndex: event.data.stepIndex,
    turnId: event.data.turnId,
  })

const modelChargeDecision = (
  winner: WinningStep,
  modelId: string | undefined
): ModelChargeDecision => {
  const { row } = winner
  const completed = stepCompletedEventSchema.safeParse(winner.event)
  if (!completed.success) {
    return skippedCharge(row, 'invalid_step_event')
  }
  const event = completed.data
  const { usage } = event.data
  if (usage?.costUsd === undefined) {
    return skippedCharge(row, 'missing_reported_cost')
  }
  if (usage.costUsd === 0) {
    return skippedCharge(row, 'zero_reported_cost')
  }

  const amount = (-usage.costUsd).toFixed(6)
  if (amount === '-0.000000') {
    return skippedCharge(row, 'cost_below_ledger_precision')
  }
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) {
    return skippedCharge(row, 'missing_reported_tokens')
  }
  if (modelId === undefined) {
    return skippedCharge(row, 'missing_reported_model')
  }

  return {
    amount,
    cacheReadTokens: usage.cacheReadTokens ?? null,
    cacheWriteTokens: usage.cacheWriteTokens ?? null,
    conversationId: row.conversationId,
    finishReason: event.data.finishReason,
    gatewayCostUsd: usage.costUsd.toFixed(8),
    generationId: event.data.providerMetadata?.gateway.generationId ?? null,
    ingestionSequence: row.ingestionSequence,
    inputTokens: usage.inputTokens,
    kind: 'charge',
    modelId,
    outputTokens: usage.outputTokens,
    sequence: event.data.sequence,
    sessionEventId: row.metaId,
    sessionId: row.sessionId,
    stepIndex: event.data.stepIndex,
    taskId: row.taskId,
    turnId: event.data.turnId,
  }
}

export const planWinningModelCharges = (
  rows: readonly PersistedEventProjectionRow[]
): readonly ModelChargeDecision[] => {
  const orderedRows = [...rows].sort(
    (left, right) => left.ingestionSequence - right.ingestionSequence
  )
  const modelIds = new Map<string, string>()
  const winningSteps = new Map<string, WinningStep>()
  const invalidSteps: SkippedModelCharge[] = []

  for (const row of orderedRows) {
    if (row.eventKind === 'session.started') {
      const started = sessionStartedEventSchema.safeParse(row.event)
      const modelId = started.success
        ? started.data.data.runtime?.modelId
        : undefined
      if (modelId !== undefined) {
        modelIds.set(row.sessionId, modelId)
      }
      continue
    }
    if (row.eventKind !== 'step.completed') {
      continue
    }

    const completed = stepCoordinateEventSchema.safeParse(row.event)
    if (!completed.success) {
      invalidSteps.push(skippedCharge(row, 'invalid_step_event'))
      continue
    }
    winningSteps.set(chargeCoordinate(row, completed.data), {
      event: completed.data,
      row,
    })
  }

  const decisions: ModelChargeDecision[] = [...invalidSteps]
  for (const winner of winningSteps.values()) {
    decisions.push(
      modelChargeDecision(winner, modelIds.get(winner.row.sessionId))
    )
  }
  return decisions.sort(
    (left, right) => left.ingestionSequence - right.ingestionSequence
  )
}

export interface PersistedSessionLineage {
  readonly parentCallId: string | null
  readonly parentSessionId: string | null
  readonly rootSessionId: string
  readonly sessionId: string
}

export const derivePersistedSessionLineage = (
  session: z.infer<typeof sessionEventIngestionSchema>['session']
): PersistedSessionLineage => {
  if (session.kind === 'root') {
    return {
      parentCallId: null,
      parentSessionId: null,
      rootSessionId: session.sessionId,
      sessionId: session.sessionId,
    }
  }
  return {
    parentCallId: session.parentCallId,
    parentSessionId: session.parentSessionId,
    rootSessionId: session.rootSessionId,
    sessionId: session.sessionId,
  }
}

const validateOwnerBinding = async ({
  brandId,
  lineage,
  owner,
  transaction,
}: {
  readonly brandId: string
  readonly lineage: PersistedSessionLineage
  readonly owner: z.infer<typeof sessionOwnerSchema>
  readonly transaction: BrainTransaction
}): Promise<void> => {
  if (owner.kind === 'task') {
    const [task] = await transaction
      .select({
        executionMode: tasks.executionMode,
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.id, owner.taskId), eq(tasks.brandId, brandId)))
      .for('share')
      .limit(1)
    if (
      task === undefined ||
      task.executionMode !== 'agent' ||
      task.startedAt === null ||
      task.startedAt.getTime() !== owner.startedAt.getTime()
    ) {
      return fail('invalid_event', 'Session event task binding is invalid')
    }
    if (task.sessionId !== null && task.sessionId !== lineage.rootSessionId) {
      return fail(
        'invalid_event',
        'Session event root does not match the task binding'
      )
    }
    return
  }

  const [conversation] = await transaction
    .select({ sessionId: cmoConversations.sessionId })
    .from(cmoConversations)
    .where(
      and(
        eq(cmoConversations.id, owner.conversationId),
        eq(cmoConversations.brandId, brandId)
      )
    )
    .for('share')
    .limit(1)
  if (conversation === undefined) {
    return fail(
      'invalid_event',
      'Session event conversation binding is invalid'
    )
  }
  if (
    conversation.sessionId !== null &&
    conversation.sessionId !== lineage.rootSessionId
  ) {
    return fail(
      'invalid_event',
      'Session event root does not match the conversation binding'
    )
  }
}

const ownerColumns = (owner: z.infer<typeof sessionOwnerSchema>) => {
  if (owner.kind === 'task') {
    return { conversationId: null, taskId: owner.taskId }
  }
  return { conversationId: owner.conversationId, taskId: null }
}

const requireExactReplay = ({
  brandId,
  event,
  existing,
  lineage,
  owner,
  occurredAt,
}: {
  readonly brandId: string
  readonly event: SessionEventEnvelope
  readonly existing: {
    readonly brandId: string
    readonly conversationId: string | null
    readonly event: unknown
    readonly eventKind: string
    readonly metaId: string
    readonly occurredAt: Date | null
    readonly parentCallId: string | null
    readonly parentSessionId: string | null
    readonly rootSessionId: string
    readonly sessionId: string
    readonly taskId: string | null
  }
  readonly lineage: PersistedSessionLineage
  readonly occurredAt: Date
  readonly owner: ReturnType<typeof ownerColumns>
}): void => {
  const replayMatches =
    existing.brandId === brandId &&
    existing.conversationId === owner.conversationId &&
    existing.eventKind === event.type &&
    existing.metaId === event.meta.id &&
    existing.occurredAt?.getTime() === occurredAt.getTime() &&
    existing.parentCallId === lineage.parentCallId &&
    existing.parentSessionId === lineage.parentSessionId &&
    existing.rootSessionId === lineage.rootSessionId &&
    existing.sessionId === lineage.sessionId &&
    existing.taskId === owner.taskId &&
    canonicalize(existing.event) === canonicalize(event)
  if (!replayMatches) {
    fail(
      'invalid_event',
      'The Eve event id already exists with different persisted semantics'
    )
  }
}

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
  | { readonly kind: 'unsupported_task'; readonly taskId: string }

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

const settleTaskFromRootCompletion = async ({
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
      completion: tasks.completion,
      executionMode: tasks.executionMode,
      kind: tasks.kind,
      sessionId: tasks.sessionId,
      status: tasks.status,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.brandId, brandId)))
    .for('update')
    .limit(1)
  if (task === undefined || task.executionMode !== 'agent') {
    return fail('invalid_event', 'Terminal event task binding is invalid')
  }
  if (task.sessionId !== null && task.sessionId !== sessionId) {
    return fail(
      'invalid_event',
      'Only the authoritative task session can settle the task'
    )
  }
  if (task.kind !== PHASE_ZERO_PRODUCT_MARKETER_KIND) {
    return { kind: 'unsupported_task', taskId }
  }

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

  const completion = productMarketerCompletionSchema.safeParse(task.completion)
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

type RootTaskAbort = 'session_failed' | 'turn_cancelled' | 'turn_failed'

const rootTaskAbortFromEventType = (eventType: string): RootTaskAbort => {
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

const settleTaskFromRootAbort = async ({
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
      executionMode: tasks.executionMode,
      kind: tasks.kind,
      sessionId: tasks.sessionId,
      status: tasks.status,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.brandId, brandId)))
    .for('update')
    .limit(1)
  if (task === undefined || task.executionMode !== 'agent') {
    return fail('invalid_event', 'Terminal event task binding is invalid')
  }
  if (task.sessionId !== null && task.sessionId !== sessionId) {
    return fail(
      'invalid_event',
      'Only the authoritative task session can fail the task'
    )
  }
  if (task.kind !== PHASE_ZERO_PRODUCT_MARKETER_KIND) {
    return { kind: 'unsupported_task', taskId }
  }
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

export type AppliedCharge =
  | {
      readonly kind: 'already_charged' | 'charged'
      readonly sessionEventId: string
    }
  | SkippedModelCharge

const projectRootCharges = async ({
  brandId,
  rootSessionId,
  terminalEventId,
  transaction,
}: {
  readonly brandId: string
  readonly rootSessionId: string
  readonly terminalEventId: string
  readonly transaction: BrainTransaction
}): Promise<readonly AppliedCharge[]> => {
  const rows = await transaction
    .select({
      conversationId: sessionEvents.conversationId,
      event: sessionEvents.event,
      eventKind: sessionEvents.eventKind,
      ingestionSequence: sessionEvents.ingestionSequence,
      metaId: sessionEvents.metaId,
      sessionId: sessionEvents.sessionId,
      taskId: sessionEvents.taskId,
    })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.brandId, brandId),
        eq(sessionEvents.rootSessionId, rootSessionId)
      )
    )
    .orderBy(asc(sessionEvents.ingestionSequence))

  const decisions = planWinningModelCharges(rows)
  const chargeCandidates = decisions.filter(
    (decision): decision is ModelChargeCandidate => decision.kind === 'charge'
  )
  const insertedIds = new Set<string>()
  if (chargeCandidates.length > 0) {
    const inserted = await transaction
      .insert(creditLedger)
      .values(
        chargeCandidates.map((decision) => ({
          amount: decision.amount,
          brandId,
          conversationId: decision.conversationId,
          entryType: 'model_charge' as const,
          gatewayCostUsd: decision.gatewayCostUsd,
          generationId: decision.generationId,
          inputTokens: decision.inputTokens,
          metadata: {
            cacheReadTokens: decision.cacheReadTokens,
            cacheWriteTokens: decision.cacheWriteTokens,
            finishReason: decision.finishReason,
            projectedAtTerminalEventId: terminalEventId,
            sequence: decision.sequence,
            stepIndex: decision.stepIndex,
            turnId: decision.turnId,
          },
          modelId: decision.modelId,
          outputTokens: decision.outputTokens,
          sessionEventId: decision.sessionEventId,
          sessionId: decision.sessionId,
          taskId: decision.taskId,
        }))
      )
      .onConflictDoNothing()
      .returning({ sessionEventId: creditLedger.sessionEventId })
    for (const row of inserted) {
      if (row.sessionEventId !== null) {
        insertedIds.add(row.sessionEventId)
      }
    }
  }
  return decisions.map((decision): AppliedCharge => {
    if (decision.kind === 'skipped') {
      return decision
    }
    return {
      kind: insertedIds.has(decision.sessionEventId)
        ? 'charged'
        : 'already_charged',
      sessionEventId: decision.sessionEventId,
    }
  })
}

export interface IngestSessionEventResult {
  readonly charges: readonly AppliedCharge[]
  readonly event: 'inserted' | 'replayed'
  readonly ingestionSequence: number
  readonly metaId: string
  readonly settlement: TaskSettlement
}

export const isAuthoritativeRootCompletion = ({
  event,
  session,
}: {
  readonly event: SessionEventEnvelope
  readonly session: z.infer<typeof sessionEventIngestionSchema>['session']
}): boolean => session.kind === 'root' && event.type === 'session.completed'

export const isAuthoritativeRootChargeBoundary = ({
  event,
  session,
}: {
  readonly event: SessionEventEnvelope
  readonly session: z.infer<typeof sessionEventIngestionSchema>['session']
}): boolean =>
  session.kind === 'root' &&
  (event.type === 'session.completed' ||
    event.type === 'session.failed' ||
    event.type === 'session.waiting' ||
    event.type === 'turn.cancelled' ||
    event.type === 'turn.failed')

export const isAuthoritativeRootTerminal = ({
  event,
  session,
}: {
  readonly event: SessionEventEnvelope
  readonly session: z.infer<typeof sessionEventIngestionSchema>['session']
}): boolean =>
  session.kind === 'root' &&
  (event.type === 'session.completed' ||
    event.type === 'session.failed' ||
    event.type === 'turn.cancelled' ||
    event.type === 'turn.failed')

export const ingestSessionEvent = async ({
  database,
  input,
}: {
  readonly database: Database
  readonly input: SessionEventIngestion
}): Promise<IngestSessionEventResult> => {
  const parsed = sessionEventIngestionSchema.parse(input)
  const brandId = parsed.auth.initiatingBrandId
  const lineage = derivePersistedSessionLineage(parsed.session)
  const owner = ownerColumns(parsed.owner)
  const occurredAt = new Date(parsed.event.meta.at)

  return await database.transaction(async (transaction) => {
    await validateOwnerBinding({
      brandId,
      lineage,
      owner: parsed.owner,
      transaction,
    })

    const [inserted] = await transaction
      .insert(sessionEvents)
      .values({
        brandId,
        conversationId: owner.conversationId,
        event: parsed.event,
        eventKind: parsed.event.type,
        metaId: parsed.event.meta.id,
        occurredAt,
        parentCallId: lineage.parentCallId,
        parentSessionId: lineage.parentSessionId,
        rootSessionId: lineage.rootSessionId,
        sessionId: lineage.sessionId,
        taskId: owner.taskId,
      })
      .onConflictDoNothing()
      .returning({
        ingestionSequence: sessionEvents.ingestionSequence,
        metaId: sessionEvents.metaId,
      })

    let eventDisposition: 'inserted' | 'replayed' = 'inserted'
    let ingestionSequence: number
    if (inserted === undefined) {
      const [existing] = await transaction
        .select({
          brandId: sessionEvents.brandId,
          conversationId: sessionEvents.conversationId,
          event: sessionEvents.event,
          eventKind: sessionEvents.eventKind,
          ingestionSequence: sessionEvents.ingestionSequence,
          metaId: sessionEvents.metaId,
          occurredAt: sessionEvents.occurredAt,
          parentCallId: sessionEvents.parentCallId,
          parentSessionId: sessionEvents.parentSessionId,
          rootSessionId: sessionEvents.rootSessionId,
          sessionId: sessionEvents.sessionId,
          taskId: sessionEvents.taskId,
        })
        .from(sessionEvents)
        .where(eq(sessionEvents.metaId, parsed.event.meta.id))
        .limit(1)
      if (existing === undefined) {
        return fail(
          'invalid_event',
          'Event conflict did not resolve to a persisted Eve event'
        )
      }
      requireExactReplay({
        brandId,
        event: parsed.event,
        existing,
        lineage,
        occurredAt,
        owner,
      })
      eventDisposition = 'replayed'
      const { ingestionSequence: replaySequence } = existing
      ingestionSequence = replaySequence
    } else {
      const { ingestionSequence: insertedSequence } = inserted
      ingestionSequence = insertedSequence
    }

    const eventContext = {
      event: parsed.event,
      session: parsed.session,
    }
    const isChargeBoundary = isAuthoritativeRootChargeBoundary(eventContext)
    const isAuthoritativeTerminal = isAuthoritativeRootTerminal(eventContext)
    if (!(isChargeBoundary || isAuthoritativeTerminal)) {
      return {
        charges: [],
        event: eventDisposition,
        ingestionSequence,
        metaId: parsed.event.meta.id,
        settlement: { kind: 'not_applicable' },
      }
    }

    const charges = isChargeBoundary
      ? await projectRootCharges({
          brandId,
          rootSessionId: lineage.rootSessionId,
          terminalEventId: parsed.event.meta.id,
          transaction,
        })
      : []
    let settlement: TaskSettlement = { kind: 'not_applicable' }
    if (parsed.owner.kind === 'task' && isAuthoritativeTerminal) {
      const settlementInput = {
        brandId,
        occurredAt,
        sessionId: lineage.sessionId,
        taskId: parsed.owner.taskId,
        transaction,
      }
      if (parsed.event.type === 'session.completed') {
        settlement = await settleTaskFromRootCompletion(settlementInput)
      } else {
        settlement = await settleTaskFromRootAbort({
          ...settlementInput,
          abort: rootTaskAbortFromEventType(parsed.event.type),
        })
      }
    }

    return {
      charges,
      event: eventDisposition,
      ingestionSequence,
      metaId: parsed.event.meta.id,
      settlement,
    }
  })
}
