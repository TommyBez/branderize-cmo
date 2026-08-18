import type { ClientSessionState, MessageStreamEvent } from 'eve/client'

export type CancellationState = 'cancelling' | 'idle' | 'requested'

export interface CmoConsoleProps {
  readonly brandId: string
  readonly conversationId: string
  readonly initialEvents: readonly MessageStreamEvent[]
  readonly initialSession: ClientSessionState | undefined
  readonly initialSourceTaskId: string | null
  readonly readOnly: boolean
  readonly recoveryRequired: boolean
}

export type InteractiveCmoConsoleProps = Omit<
  CmoConsoleProps,
  'recoveryRequired'
>

export const activeTurnFrom = (
  events: readonly MessageStreamEvent[]
): string | undefined => {
  let activeTurnId: string | undefined
  for (const event of events) {
    if (event.type === 'turn.started') {
      activeTurnId = event.data.turnId
    } else if (
      event.type === 'turn.cancelled' ||
      event.type === 'turn.completed' ||
      event.type === 'turn.failed' ||
      event.type === 'session.failed' ||
      event.type === 'session.waiting' ||
      event.type === 'session.completed'
    ) {
      activeTurnId = undefined
    }
  }
  return activeTurnId
}
