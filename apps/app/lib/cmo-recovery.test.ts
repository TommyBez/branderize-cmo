import type { ClientSessionState, MessageStreamEvent } from 'eve/client'
import { describe, expect, it } from 'vitest'

import {
  type CmoRecoverySession,
  cmoEventsEndAtCurrentTurnBoundary,
  projectCmoMessages,
  readCompleteCmoEventPrefix,
  recoverCmoSessionToCurrentTurnBoundary,
} from './cmo-recovery'

const meta = (id: string) => ({
  at: '2026-08-17T12:00:00.000Z',
  id,
})

const turnStarted = {
  data: { sequence: 1, turnId: 'turn-current' },
  meta: meta('event-turn-started'),
  type: 'turn.started',
} satisfies MessageStreamEvent

const messageReceived = {
  data: {
    message: 'Piano del trimestre',
    sequence: 1,
    turnId: 'turn-current',
  },
  meta: meta('event-message-received'),
  type: 'message.received',
} satisfies MessageStreamEvent

const turnCancelled = {
  data: { sequence: 1, turnId: 'turn-current' },
  meta: meta('event-turn-cancelled'),
  type: 'turn.cancelled',
} satisfies MessageStreamEvent

const sessionWaiting = {
  data: {
    continuationToken: 'session-cmo',
    wait: 'next-user-message',
  },
  meta: meta('event-session-waiting'),
  type: 'session.waiting',
} satisfies MessageStreamEvent

const createRecoverySession = (
  streamedEvents: readonly MessageStreamEvent[]
): {
  readonly observed: {
    readonly closed: () => boolean
    readonly startIndex: () => number | undefined
  }
  readonly session: CmoRecoverySession
} => {
  let closed = false
  let startIndex: number | undefined
  let state: ClientSessionState = {
    sessionId: 'session-cmo',
    streamIndex: 2,
  }

  const session: CmoRecoverySession = {
    get state() {
      return state
    },
    stream(options) {
      startIndex = options?.startIndex
      // biome-ignore lint/suspicious/useAwait: the production boundary exposes an AsyncIterable
      return (async function* recoveryStream() {
        let emitted = 0
        try {
          for (const event of streamedEvents) {
            emitted += 1
            yield event
          }
        } finally {
          closed = true
          state = {
            sessionId: state.sessionId,
            streamIndex: state.streamIndex + emitted,
          }
        }
      })()
    },
  }

  return {
    observed: {
      closed: () => closed,
      startIndex: () => startIndex,
    },
    session,
  }
}

describe('CMO reload recovery', () => {
  it('reads every ordered persisted page and rejects a stuck cursor', async () => {
    const cursors: (number | null)[] = []
    const events = await readCompleteCmoEventPrefix({
      readPage: (afterIngestionSequence) => {
        cursors.push(afterIngestionSequence)
        if (afterIngestionSequence === null) {
          return Promise.resolve({
            events: ['event-1', 'event-2'],
            nextAfterIngestionSequence: 2,
          })
        }
        return Promise.resolve({
          events: ['event-3'],
          nextAfterIngestionSequence: null,
        })
      },
    })

    expect(events).toEqual(['event-1', 'event-2', 'event-3'])
    expect(cursors).toEqual([null, 2])
    await expect(
      readCompleteCmoEventPrefix({
        readPage: () =>
          Promise.resolve({
            events: [],
            nextAfterIngestionSequence: 2,
          }),
      })
    ).rejects.toThrow('cursor did not advance')
  })

  it('classifies only a current session boundary as ready to mount', () => {
    expect(cmoEventsEndAtCurrentTurnBoundary([])).toBe(false)
    expect(cmoEventsEndAtCurrentTurnBoundary([turnStarted])).toBe(false)
    expect(
      cmoEventsEndAtCurrentTurnBoundary([turnStarted, turnCancelled])
    ).toBe(false)
    expect(
      cmoEventsEndAtCurrentTurnBoundary([
        turnStarted,
        turnCancelled,
        sessionWaiting,
      ])
    ).toBe(true)
  })

  it('projects the ordered recovery prefix with Eve public semantics', () => {
    expect(projectCmoMessages([turnStarted, messageReceived])).toEqual([
      expect.objectContaining({
        id: 'turn-current:user',
        role: 'user',
      }),
    ])
  })

  it('follows the snapshot cursor through cancellation until waiting', async () => {
    const { observed, session } = createRecoverySession([
      turnCancelled,
      sessionWaiting,
      {
        meta: meta('event-after-boundary'),
        type: 'session.completed',
      },
    ])
    const observedPrefixes: (readonly MessageStreamEvent[])[] = []

    const result = await recoverCmoSessionToCurrentTurnBoundary({
      initialEvents: [turnStarted, messageReceived],
      onEvent: (events) => observedPrefixes.push([...events]),
      session,
      signal: new AbortController().signal,
    })

    expect(result.events).toEqual([
      turnStarted,
      messageReceived,
      turnCancelled,
      sessionWaiting,
    ])
    expect(result.session).toEqual({
      sessionId: 'session-cmo',
      streamIndex: 4,
    })
    expect(observed.startIndex()).toBe(2)
    expect(observed.closed()).toBe(true)
    expect(observedPrefixes).toHaveLength(2)
  })

  it('fails closed and closes a stream that ends before a boundary', async () => {
    const { observed, session } = createRecoverySession([turnCancelled])

    await expect(
      recoverCmoSessionToCurrentTurnBoundary({
        initialEvents: [turnStarted],
        session,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('ended before the current turn boundary')
    expect(observed.closed()).toBe(true)
  })
})
