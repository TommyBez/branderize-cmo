import type { Database } from '@repo/db/client'
import { sessionEvents } from '@repo/db/schema/domain'
import { eq } from 'drizzle-orm'

import { canonicalize } from '../canonical'
import { fail } from '../errors'
import { type AppliedCharge, projectRootCharges } from './charges'
import {
  derivePersistedSessionLineage,
  isAuthoritativeRootChargeBoundary,
  isAuthoritativeRootTerminal,
  ownerColumns,
  type PersistedOwnerColumns,
  type PersistedSessionLineage,
  type SessionEventEnvelope,
  type SessionEventIngestion,
  sessionEventIngestionSchema,
  validateOwnerBinding,
} from './contracts'
import {
  rootTaskAbortFromEventType,
  settleTaskFromRootAbort,
  settleTaskFromRootCompletion,
  type TaskSettlement,
} from './task-settlement'

interface ExistingSessionEvent {
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

const requireExactReplay = ({
  brandId,
  event,
  existing,
  lineage,
  occurredAt,
  owner,
}: {
  readonly brandId: string
  readonly event: SessionEventEnvelope
  readonly existing: ExistingSessionEvent
  readonly lineage: PersistedSessionLineage
  readonly occurredAt: Date
  readonly owner: PersistedOwnerColumns
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

export interface IngestSessionEventResult {
  readonly charges: readonly AppliedCharge[]
  readonly event: 'inserted' | 'replayed'
  readonly ingestionSequence: number
  readonly metaId: string
  readonly settlement: TaskSettlement
}

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
