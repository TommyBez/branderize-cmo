import type { ClientSessionState } from 'eve/client'
import { Client } from 'eve/client'
import { useEveAgent } from 'eve/react'
import { useRouter } from 'next/navigation'
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react'

import { checkpointCmoConversationAction } from '@/lib/actions'
import {
  activeTurnFrom,
  type CancellationState,
  type InteractiveCmoConsoleProps,
} from './cmo-console-types'
import { CmoTranscript } from './cmo-console-view'

const cancellationWasRequested = (value: {
  readonly requested: boolean
}): boolean => value.requested

export const InteractiveCmoConsole = ({
  brandId,
  conversationId,
  initialEvents,
  initialSession,
  initialSourceTaskId,
  readOnly,
}: InteractiveCmoConsoleProps) => {
  const router = useRouter()
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const sessionIdRef = useRef(initialSession?.sessionId)
  const latestCheckpointRef = useRef(-1)
  const cancellationRef = useRef<{
    requested: boolean
    sentTurnId?: string
    turnId?: string
  }>({
    requested: false,
    turnId: activeTurnFrom(initialEvents),
  })
  const [cancellationState, setCancellationState] =
    useState<CancellationState>('idle')
  const [cancellationError, setCancellationError] = useState<string | null>(
    null
  )
  const [checkpointError, setCheckpointError] = useState<string | null>(null)
  const [sourceTaskId, setSourceTaskId] = useState(initialSourceTaskId)
  const [, startCheckpointTransition] = useTransition()
  const proxyHost = `/api/brands/${brandId}/cmo/${conversationId}`
  const [client] = useState(() => new Client({ host: proxyHost }))

  const checkpointSession = useCallback(
    (session: ClientSessionState | undefined) => {
      if (
        readOnly ||
        session === undefined ||
        session.streamIndex <= latestCheckpointRef.current
      ) {
        return
      }

      latestCheckpointRef.current = session.streamIndex
      startCheckpointTransition(async () => {
        try {
          await checkpointCmoConversationAction({
            brandId,
            conversationId,
            sessionId: session.sessionId,
            streamIndex: session.streamIndex,
          })
          setCheckpointError(null)
        } catch {
          setCheckpointError(
            'Il cursore di recupero non è stato salvato. Ricarica per riprovare.'
          )
        }
      })
    },
    [brandId, conversationId, readOnly]
  )

  useEffect(() => {
    checkpointSession(initialSession)
  }, [checkpointSession, initialSession])

  const cancelTurn = useCallback(
    (turnId: string) => {
      const cancellation = cancellationRef.current
      const sessionId = sessionIdRef.current
      if (cancellation.sentTurnId === turnId || sessionId === undefined) {
        return
      }

      cancellation.sentTurnId = turnId
      setCancellationState('cancelling')
      client.sessions
        .attach(sessionId)
        .cancel({ turnId })
        .catch(() => {
          if (cancellationRef.current !== cancellation) {
            return
          }
          cancellation.requested = false
          cancellation.sentTurnId = undefined
          setCancellationError('Non è stato possibile fermare questo turno.')
          setCancellationState('idle')
        })
    },
    [client]
  )

  const agent = useEveAgent({
    host: proxyHost,
    initialEvents,
    initialSession,
    onEvent(event) {
      if (event.type === 'turn.started') {
        cancellationRef.current.turnId = event.data.turnId
        if (cancellationWasRequested(cancellationRef.current)) {
          cancelTurn(event.data.turnId)
        }
      } else if (
        event.type === 'turn.cancelled' ||
        event.type === 'turn.completed' ||
        event.type === 'turn.failed'
      ) {
        cancellationRef.current = { requested: false }
        setCancellationState('idle')
      }
    },
    onFinish(snapshot) {
      checkpointSession(snapshot.session)
    },
    onSessionChange(session) {
      sessionIdRef.current = session?.sessionId
      checkpointSession(session)
    },
  })
  const busy = agent.status === 'streaming' || agent.status === 'submitted'
  const errorMessage =
    cancellationError ?? checkpointError ?? agent.error?.message
  let statusLabel = 'Pronto'
  if (readOnly) {
    statusLabel = 'Sola lettura'
  }
  if (busy) {
    statusLabel = 'CMO al lavoro'
  }

  const refresh = useCallback(() => router.refresh(), [router])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const composer = composerRef.current
    const message = composer?.value.trim() ?? ''
    if (message.length === 0 || busy || readOnly) {
      return
    }
    cancellationRef.current = { requested: false }
    setCancellationError(null)
    setCancellationState('idle')
    if (composer !== null) {
      composer.value = ''
    }
    await agent.send(
      message,
      sourceTaskId === null
        ? undefined
        : {
            headers: {
              'x-branderize-source-task-id': sourceTaskId,
            },
          }
    )
    if (sourceTaskId !== null) {
      setSourceTaskId(null)
      router.replace(`/brands/${brandId}/cmo/${conversationId}`)
    }
  }

  const requestCancellation = () => {
    if (!busy || cancellationState !== 'idle') {
      return
    }
    cancellationRef.current.requested = true
    setCancellationError(null)
    setCancellationState('requested')
    const { turnId } = cancellationRef.current
    if (turnId !== undefined) {
      cancelTurn(turnId)
    }
  }

  return (
    <div className="cmo-console">
      <div aria-live="polite" className="cmo-status">
        <span
          aria-hidden="true"
          className={`status-dot status-dot--${agent.status}`}
        />
        {statusLabel}
        <button className="text-button" onClick={refresh} type="button">
          Ricarica
        </button>
      </div>

      {errorMessage === undefined || errorMessage === null ? null : (
        <p className="form-feedback form-feedback--error" role="alert">
          {errorMessage}
        </p>
      )}

      <CmoTranscript messages={agent.data.messages} />

      <form className="cmo-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="cmo-message">
          Messaggio al CMO
        </label>
        <textarea
          disabled={busy || readOnly}
          id="cmo-message"
          maxLength={20_000}
          placeholder={
            readOnly
              ? 'La conversazione è disponibile in sola lettura.'
              : 'Dichiara il risultato che vuoi ottenere…'
          }
          ref={composerRef}
          rows={3}
        />
        <div className="cmo-composer__actions">
          <small>
            {sourceTaskId === null
              ? 'I turni sono privati al proprietario della conversazione.'
              : `Questo turno attesta il task ${sourceTaskId}.`}
          </small>
          {busy ? (
            <button
              className="button button--quiet"
              disabled={cancellationState !== 'idle'}
              onClick={requestCancellation}
              type="button"
            >
              {cancellationState === 'idle' ? 'Ferma turno' : 'Arresto…'}
            </button>
          ) : (
            <button className="button" disabled={readOnly} type="submit">
              Invia
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
