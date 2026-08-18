import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  derivePersistedSessionLineage,
  isAuthoritativeRootChargeBoundary,
  isAuthoritativeRootCompletion,
  isAuthoritativeRootTerminal,
  type PersistedEventProjectionRow,
  parsePersistableSessionEvent,
  planWinningModelCharges,
  type SessionEventEnvelope,
  sessionEventEnvelopeSchema,
  sessionEventIngestionSchema,
} from './session-events'

const BRAND_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const ROOT_SESSION_ID = 'session_root_fixture_01'
const TASK_STARTED_AT = new Date('2026-08-17T11:59:00.000Z')

const fixtureSchema = z.array(sessionEventEnvelopeSchema)
const retryFixtureSchema = z
  .object({
    interruptedStepAttempts: z.array(sessionEventEnvelopeSchema),
  })
  .passthrough()

const readFixture = async (name: string): Promise<unknown> => {
  const raw = await readFile(
    new URL(`../../../fixtures/eve/${name}`, import.meta.url),
    'utf8'
  )
  const parsed: unknown = JSON.parse(raw)
  return parsed
}

const projectionRows = ({
  events,
  sessionId = ROOT_SESSION_ID,
}: {
  readonly events: readonly SessionEventEnvelope[]
  readonly sessionId?: string
}): readonly PersistedEventProjectionRow[] =>
  events.map((event, index) => ({
    conversationId: null,
    event,
    eventKind: event.type,
    ingestionSequence: index + 1,
    metaId: event.meta.id,
    sessionId,
    taskId: TASK_ID,
  }))

const completedStep = ({
  costUsd,
  eventId,
  generationId,
  stepIndex,
}: {
  readonly costUsd?: number
  readonly eventId: string
  readonly generationId?: string
  readonly stepIndex: number
}): SessionEventEnvelope =>
  sessionEventEnvelopeSchema.parse({
    data: {
      finishReason: 'stop',
      ...(generationId === undefined
        ? {}
        : {
            providerMetadata: {
              gateway: { generationId },
            },
          }),
      sequence: 0,
      stepIndex,
      turnId: 'turn_fixture_01',
      usage: {
        ...(costUsd === undefined ? {} : { costUsd }),
        inputTokens: 100 + stepIndex,
        outputTokens: 20 + stepIndex,
      },
    },
    meta: {
      at: `2026-08-17T12:00:0${stepIndex}.000Z`,
      id: eventId,
    },
    type: 'step.completed',
  })

const startedSession = (): SessionEventEnvelope =>
  sessionEventEnvelopeSchema.parse({
    data: {
      runtime: { modelId: 'dynamic:deepseek/deepseek-v4-pro-0813' },
    },
    meta: {
      at: '2026-08-17T12:00:00.000Z',
      id: 'evt_session_started',
    },
    type: 'session.started',
  })

describe('session event boundaries', () => {
  it('drops optional undefined fields before validating persisted JSON', () => {
    expect(
      parsePersistableSessionEvent({
        data: {
          error: undefined,
          reason: 'provider_error',
        },
        meta: {
          at: '2026-08-17T12:00:00.000Z',
          id: 'evt_optional_undefined',
        },
        type: 'turn.failed',
      })
    ).toEqual({
      data: { reason: 'provider_error' },
      meta: {
        at: '2026-08-17T12:00:00.000Z',
        id: 'evt_optional_undefined',
      },
      type: 'turn.failed',
    })
  })

  it('requires identical initiating and current tenant attribution', () => {
    const result = sessionEventIngestionSchema.safeParse({
      auth: {
        currentBrandId: '44444444-4444-4444-8444-444444444444',
        initiatingBrandId: BRAND_ID,
      },
      event: {
        meta: {
          at: '2026-08-17T12:00:00.000Z',
          id: 'evt_mismatched_brand',
        },
        type: 'session.started',
      },
      owner: { kind: 'task', startedAt: TASK_STARTED_AT, taskId: TASK_ID },
      session: { kind: 'root', sessionId: ROOT_SESSION_ID },
    })

    expect(result.success).toBe(false)
  })

  it('preserves exact root and immediate-parent lineage', () => {
    expect(
      derivePersistedSessionLineage({
        kind: 'child',
        parentCallId: 'call_fixture_01',
        parentSessionId: ROOT_SESSION_ID,
        rootSessionId: ROOT_SESSION_ID,
        sessionId: 'session_child_fixture_01',
      })
    ).toEqual({
      parentCallId: 'call_fixture_01',
      parentSessionId: ROOT_SESSION_ID,
      rootSessionId: ROOT_SESSION_ID,
      sessionId: 'session_child_fixture_01',
    })
  })

  it('accepts only a root session.completed as authoritative', () => {
    const terminal = sessionEventEnvelopeSchema.parse({
      meta: {
        at: '2026-08-17T12:00:00.000Z',
        id: 'evt_terminal',
      },
      type: 'session.completed',
    })

    expect(
      isAuthoritativeRootCompletion({
        event: terminal,
        session: { kind: 'root', sessionId: ROOT_SESSION_ID },
      })
    ).toBe(true)
    expect(
      isAuthoritativeRootCompletion({
        event: terminal,
        session: {
          kind: 'child',
          parentCallId: 'call_fixture_01',
          parentSessionId: ROOT_SESSION_ID,
          rootSessionId: ROOT_SESSION_ID,
          sessionId: 'session_child_fixture_01',
        },
      })
    ).toBe(false)
  })

  it('treats a root session.failed as terminal but not successful', () => {
    const terminal = sessionEventEnvelopeSchema.parse({
      data: {
        code: 'runtime_failure',
        message: 'The durable task session failed.',
        sessionId: ROOT_SESSION_ID,
      },
      meta: {
        at: '2026-08-17T12:00:00.000Z',
        id: 'evt_failed_terminal',
      },
      type: 'session.failed',
    })

    expect(
      isAuthoritativeRootTerminal({
        event: terminal,
        session: { kind: 'root', sessionId: ROOT_SESSION_ID },
      })
    ).toBe(true)
    expect(
      isAuthoritativeRootCompletion({
        event: terminal,
        session: { kind: 'root', sessionId: ROOT_SESSION_ID },
      })
    ).toBe(false)
  })

  it('finalizes charges at root waiting and task abort boundaries', () => {
    const rootSession = { kind: 'root' as const, sessionId: ROOT_SESSION_ID }
    for (const type of ['session.waiting', 'turn.cancelled', 'turn.failed']) {
      const event = sessionEventEnvelopeSchema.parse({
        meta: {
          at: '2026-08-17T12:00:00.000Z',
          id: `evt_${type}`,
        },
        type,
      })
      expect(
        isAuthoritativeRootChargeBoundary({ event, session: rootSession })
      ).toBe(true)
    }

    const waiting = sessionEventEnvelopeSchema.parse({
      meta: {
        at: '2026-08-17T12:00:00.000Z',
        id: 'evt_child_waiting',
      },
      type: 'session.waiting',
    })
    expect(
      isAuthoritativeRootChargeBoundary({
        event: waiting,
        session: {
          kind: 'child',
          parentCallId: 'call_fixture_01',
          parentSessionId: ROOT_SESSION_ID,
          rootSessionId: ROOT_SESSION_ID,
          sessionId: 'session_child_fixture_01',
        },
      })
    ).toBe(false)
    expect(
      isAuthoritativeRootTerminal({ event: waiting, session: rootSession })
    ).toBe(false)
  })

  it('keeps conversation and task ownership mutually exclusive', () => {
    const result = sessionEventIngestionSchema.safeParse({
      auth: {
        currentBrandId: BRAND_ID,
        initiatingBrandId: BRAND_ID,
      },
      event: {
        meta: {
          at: '2026-08-17T12:00:00.000Z',
          id: 'evt_two_owners',
        },
        type: 'session.started',
      },
      owner: {
        conversationId: CONVERSATION_ID,
        kind: 'conversation',
        taskId: TASK_ID,
      },
      session: { kind: 'root', sessionId: ROOT_SESSION_ID },
    })

    expect(result.success).toBe(false)
  })

  it('requires the trusted task execution generation on task events', () => {
    const result = sessionEventIngestionSchema.safeParse({
      auth: {
        currentBrandId: BRAND_ID,
        initiatingBrandId: BRAND_ID,
      },
      event: {
        meta: {
          at: '2026-08-17T12:00:00.000Z',
          id: 'evt_missing_task_generation',
        },
        type: 'session.started',
      },
      owner: { kind: 'task', taskId: TASK_ID },
      session: { kind: 'root', sessionId: ROOT_SESSION_ID },
    })

    expect(result.success).toBe(false)
  })
})

describe('winning model charge projection', () => {
  it('projects the fixture cost and optional Gateway generation id exactly', async () => {
    const events = fixtureSchema.parse(
      await readFixture('root-task-stream.json')
    )

    expect(planWinningModelCharges(projectionRows({ events }))).toEqual([
      {
        amount: '-0.000400',
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        conversationId: null,
        finishReason: 'stop',
        gatewayCostUsd: '0.00040000',
        generationId: 'generation_fixture_01',
        ingestionSequence: 9,
        inputTokens: 240,
        kind: 'charge',
        modelId: 'dynamic:deepseek/deepseek-v4-pro-0813',
        outputTokens: 40,
        sequence: 0,
        sessionEventId: 'evt_01KYJBZA88B4M9XN3RTC5FDGHJ',
        sessionId: ROOT_SESSION_ID,
        stepIndex: 0,
        taskId: TASK_ID,
        turnId: 'turn_product_marketer_fixture_01',
      },
    ])
  })

  it('chooses the last event for each retry coordinate in ingestion order', () => {
    const events = [
      startedSession(),
      completedStep({
        costUsd: 0.1,
        eventId: 'evt_first_attempt',
        generationId: 'generation_first',
        stepIndex: 0,
      }),
      completedStep({
        costUsd: 0.2,
        eventId: 'evt_winning_attempt',
        generationId: 'generation_winner',
        stepIndex: 0,
      }),
      completedStep({
        costUsd: 0.3,
        eventId: 'evt_next_step',
        stepIndex: 1,
      }),
    ]

    const decisions = planWinningModelCharges(projectionRows({ events }))

    expect(decisions.map(({ sessionEventId }) => sessionEventId)).toEqual([
      'evt_winning_attempt',
      'evt_next_step',
    ])
    expect(decisions[0]).toMatchObject({
      amount: '-0.200000',
      generationId: 'generation_winner',
      kind: 'charge',
    })
    expect(decisions[1]).toMatchObject({
      generationId: null,
      kind: 'charge',
    })
  })

  it('uses the Eve retry fixture without treating coordinates as identities', async () => {
    const fixture = retryFixtureSchema.parse(
      await readFixture('event-id-semantics.json')
    )
    const decisions = planWinningModelCharges(
      projectionRows({ events: fixture.interruptedStepAttempts })
    )

    expect(decisions).toEqual([
      {
        ingestionSequence: 2,
        kind: 'skipped',
        reason: 'missing_reported_cost',
        sessionEventId: 'evt_01KYJBZA88B4M9XN3RTC5FDGHR',
      },
    ])
  })

  it('never invents a charge when Eve omits reported cost', () => {
    const decisions = planWinningModelCharges(
      projectionRows({
        events: [
          startedSession(),
          completedStep({ eventId: 'evt_without_cost', stepIndex: 0 }),
          sessionEventEnvelopeSchema.parse({
            data: {
              modelId: 'deepseek/deepseek-v4-pro-0813',
              sequence: 0,
              sessionId: ROOT_SESSION_ID,
              turnId: 'turn_fixture_01',
              usageInputTokens: 1000,
            },
            meta: {
              at: '2026-08-17T12:00:02.000Z',
              id: 'evt_compaction',
            },
            type: 'compaction.requested',
          }),
        ],
      })
    )

    expect(decisions).toEqual([
      {
        ingestionSequence: 2,
        kind: 'skipped',
        reason: 'missing_reported_cost',
        sessionEventId: 'evt_without_cost',
      },
    ])
  })
})
