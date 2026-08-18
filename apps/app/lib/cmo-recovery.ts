import type {
  ClientSession,
  ClientSessionState,
  EveMessage,
  MessageStreamEvent,
} from 'eve/client'
import { defaultMessageReducer, isCurrentTurnBoundaryEvent } from 'eve/client'

export type CmoRecoverySession = Pick<ClientSession, 'state' | 'stream'>

export interface RecoveredCmoSession {
  readonly events: readonly MessageStreamEvent[]
  readonly session: ClientSessionState
}

export interface CmoPersistedEventPage<TEvent> {
  readonly events: readonly TEvent[]
  readonly nextAfterIngestionSequence: number | null
}

export const readCompleteCmoEventPrefix = async <TEvent>({
  readPage,
}: {
  readonly readPage: (
    afterIngestionSequence: number | null
  ) => Promise<CmoPersistedEventPage<TEvent>>
}): Promise<readonly TEvent[]> => {
  const events: TEvent[] = []
  let afterIngestionSequence: number | null = null

  do {
    // biome-ignore lint/performance/noAwaitInLoops: each keyset page depends on the prior cursor
    const page = await readPage(afterIngestionSequence)
    events.push(...page.events)
    const next = page.nextAfterIngestionSequence
    if (
      next !== null &&
      afterIngestionSequence !== null &&
      next <= afterIngestionSequence
    ) {
      throw new Error('The persisted CMO transcript cursor did not advance')
    }
    afterIngestionSequence = next
  } while (afterIngestionSequence !== null)

  return events
}

export const cmoEventsEndAtCurrentTurnBoundary = (
  events: readonly MessageStreamEvent[]
): boolean => {
  const lastEvent = events.at(-1)
  return lastEvent !== undefined && isCurrentTurnBoundaryEvent(lastEvent)
}

export const projectCmoMessages = (
  events: readonly MessageStreamEvent[]
): readonly EveMessage[] => {
  const reducer = defaultMessageReducer()
  let projection = reducer.initial()
  for (const event of events) {
    projection = reducer.reduce(projection, event)
  }
  return projection.messages
}

export const recoverCmoSessionToCurrentTurnBoundary = async ({
  initialEvents,
  onEvent,
  session,
  signal,
}: {
  readonly initialEvents: readonly MessageStreamEvent[]
  readonly onEvent?: (events: readonly MessageStreamEvent[]) => void
  readonly session: CmoRecoverySession
  readonly signal: AbortSignal
}): Promise<RecoveredCmoSession> => {
  signal.throwIfAborted()
  if (cmoEventsEndAtCurrentTurnBoundary(initialEvents)) {
    return { events: initialEvents, session: session.state }
  }

  const events = [...initialEvents]
  const stream = session.stream({
    signal,
    startIndex: session.state.streamIndex,
  })
  const iterator = stream[Symbol.asyncIterator]()
  let reachedBoundary = false

  try {
    while (!reachedBoundary) {
      // biome-ignore lint/performance/noAwaitInLoops: one ordered durable stream must be consumed sequentially
      const next = await iterator.next()
      if (next.done === true) {
        break
      }
      events.push(next.value)
      onEvent?.(events)
      reachedBoundary = isCurrentTurnBoundaryEvent(next.value)
    }
  } finally {
    await iterator.return?.()
  }

  signal.throwIfAborted()
  if (!reachedBoundary) {
    throw new Error(
      'The CMO session stream ended before the current turn boundary'
    )
  }

  return { events, session: session.state }
}
