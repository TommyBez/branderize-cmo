import { creditLedger, sessionEvents } from '@repo/db/schema/domain'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { canonicalize } from '../canonical'
import type { BrainTransaction } from '../internal'
import {
  type PersistedEventProjectionRow,
  sessionEventEnvelopeSchema,
} from './contracts'

const MAX_POSTGRES_INTEGER = 2_147_483_647
const MAX_LEDGER_COST_USD = 999_999_999_999
const nonBlankIdentifierSchema = z.string().trim().min(1).max(500)
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

export type AppliedCharge =
  | {
      readonly kind: 'already_charged' | 'charged'
      readonly sessionEventId: string
    }
  | SkippedModelCharge

export const projectRootCharges = async ({
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
