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
  const readNextPage = async (
    afterIngestionSequence: number | null
  ): Promise<void> => {
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
    if (next !== null) {
      await readNextPage(next)
    }
  }

  await readNextPage(null)

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
  const readUntilBoundary = async (): Promise<boolean> => {
    const next = await iterator.next()
    if (next.done === true) {
      return false
    }

    events.push(next.value)
    onEvent?.(events)
    if (isCurrentTurnBoundaryEvent(next.value)) {
      return true
    }

    const laterEventReachedBoundary = await readUntilBoundary()
    return laterEventReachedBoundary
  }

  let reachedBoundary: boolean
  try {
    reachedBoundary = await readUntilBoundary()
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
