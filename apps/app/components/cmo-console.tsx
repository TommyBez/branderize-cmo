'use client'

import type {
  ClientSessionState,
  EveMessage,
  MessageStreamEvent,
} from 'eve/client'
import { Client } from 'eve/client'
import { useEveAgent } from 'eve/react'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'

import {
  checkpointCmoConversationAction,
  readCmoAuditFallbackAction,
} from '@/lib/actions'
import {
  projectCmoMessages,
  type RecoveredCmoSession,
  recoverCmoSessionToCurrentTurnBoundary,
} from '@/lib/cmo-recovery'
import { CmoMessage } from './cmo-message'

type CancellationState = 'cancelling' | 'idle' | 'requested'

interface CmoConsoleProps {
  readonly brandId: string
  readonly conversationId: string
  readonly initialEvents: readonly MessageStreamEvent[]
  readonly initialSession: ClientSessionState | undefined
  readonly initialSourceTaskId: string | null
  readonly readOnly: boolean
  readonly recoveryRequired: boolean
}

type InteractiveCmoConsoleProps = Omit<CmoConsoleProps, 'recoveryRequired'>

const cancellationWasRequested = (value: {
  readonly requested: boolean
}): boolean => value.requested

const activeTurnFrom = (
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

const CmoTranscript = ({
  messages,
}: {
  readonly messages: readonly EveMessage[]
}) => (
  <div className="chat-transcript">
    {messages.length === 0 ? (
      <div className="chat-empty">
        <p className="eyebrow">Conversazione privata</p>
        <h2>Parti da un risultato, non da una lista di task.</h2>
        <p>
          Il CMO può dichiarare e raffinare Intent o richiedere lavoro al
          Product Marketer quando il tuo turno identifica un obiettivo attivo
          senza ambiguità.
        </p>
      </div>
    ) : (
      messages.map((message) => (
        <CmoMessage key={message.id} message={message} />
      ))
    )}
  </div>
)

const RecoveryComposer = ({
  busy,
  cancellationState,
  onCancel,
  readOnly,
}: {
  readonly busy: boolean
  readonly cancellationState: CancellationState
  readonly onCancel: () => Promise<void>
  readonly readOnly: boolean
}) => (
  <div className="cmo-composer">
    <label className="sr-only" htmlFor="cmo-message">
      Messaggio al CMO
    </label>
    <textarea
      disabled
      id="cmo-message"
      placeholder={
        readOnly
          ? 'La conversazione è disponibile in sola lettura.'
          : 'Il turno corrente è in recupero…'
      }
      rows={3}
    />
    <div className="cmo-composer__actions">
      <small>Il transcript viene riallineato allo stream autorevole.</small>
      {busy ? (
        <button
          className="button button--quiet"
          disabled={cancellationState !== 'idle'}
          onClick={onCancel}
          type="button"
        >
          {cancellationState === 'idle' ? 'Ferma turno' : 'Arresto…'}
        </button>
      ) : null}
    </div>
  </div>
)

const RecoveryAuditFallback = ({
  messages,
  onRetry,
}: {
  readonly messages: readonly EveMessage[]
  readonly onRetry: () => void
}) => (
  <div className="cmo-console cmo-console--readonly">
    <div className="read-only-banner">
      <p className="eyebrow">Recupero runtime interrotto</p>
      <strong>La proiezione persistita resta disponibile.</strong>
      <p>
        Il prefisso audit può essere incompleto. Nessun turno sostitutivo è
        stato inviato.
      </p>
      <button className="text-button" onClick={onRetry} type="button">
        Riprova il recupero
      </button>
    </div>
    <CmoTranscript messages={messages} />
  </div>
)

const InteractiveCmoConsole = ({
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

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
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

const RecoveringCmoConsole = ({
  brandId,
  conversationId,
  initialEvents,
  initialSession,
  initialSourceTaskId,
  readOnly,
}: Omit<InteractiveCmoConsoleProps, 'initialSession'> & {
  readonly initialSession: ClientSessionState
}) => {
  const router = useRouter()
  const proxyHost = `/api/brands/${brandId}/cmo/${conversationId}`
  const [session] = useState(() =>
    new Client({ host: proxyHost }).sessions.attach(initialSession.sessionId, {
      streamIndex: initialSession.streamIndex,
    })
  )
  const [events, setEvents] = useState(initialEvents)
  const [recovered, setRecovered] = useState<RecoveredCmoSession>()
  const [fallbackMessages, setFallbackMessages] =
    useState<readonly EveMessage[]>()
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [cancellationState, setCancellationState] =
    useState<CancellationState>('idle')
  const messages = useMemo(() => projectCmoMessages(events), [events])
  const activeTurnId = activeTurnFrom(events)
  const busy = activeTurnId !== undefined

  useEffect(() => {
    const controller = new AbortController()
    const recover = async () => {
      try {
        const result = await recoverCmoSessionToCurrentTurnBoundary({
          initialEvents,
          onEvent: (nextEvents) => setEvents([...nextEvents]),
          session,
          signal: controller.signal,
        })
        setRecovered(result)
      } catch {
        if (controller.signal.aborted) {
          return
        }
        try {
          const fallback = await readCmoAuditFallbackAction({
            brandId,
            conversationId,
          })
          if (!controller.signal.aborted) {
            setFallbackMessages(fallback)
          }
        } catch {
          if (!controller.signal.aborted) {
            setRecoveryError(
              'Non è stato possibile completare il recupero dello stream.'
            )
          }
        }
      }
    }

    recover().catch(() => {
      if (!controller.signal.aborted) {
        setRecoveryError(
          'Non è stato possibile completare il recupero dello stream.'
        )
      }
    })
    return () => controller.abort()
  }, [brandId, conversationId, initialEvents, session])

  const requestCancellation = useCallback(async () => {
    if (activeTurnId === undefined || cancellationState !== 'idle') {
      return
    }
    setCancellationState('cancelling')
    setRecoveryError(null)
    try {
      await session.cancel({ turnId: activeTurnId })
    } catch {
      setCancellationState('idle')
      setRecoveryError('Non è stato possibile fermare questo turno.')
    }
  }, [activeTurnId, cancellationState, session])

  const refresh = useCallback(() => router.refresh(), [router])

  if (fallbackMessages !== undefined) {
    return (
      <RecoveryAuditFallback messages={fallbackMessages} onRetry={refresh} />
    )
  }

  if (recovered !== undefined) {
    return (
      <InteractiveCmoConsole
        brandId={brandId}
        conversationId={conversationId}
        initialEvents={recovered.events}
        initialSession={recovered.session}
        initialSourceTaskId={initialSourceTaskId}
        readOnly={readOnly}
      />
    )
  }

  return (
    <div className="cmo-console">
      <div aria-live="polite" className="cmo-status">
        <span
          aria-hidden="true"
          className={`status-dot status-dot--${
            recoveryError === null ? 'streaming' : 'error'
          }`}
        />
        {busy ? 'CMO al lavoro' : 'Recupero sessione'}
        <button className="text-button" onClick={refresh} type="button">
          Ricarica
        </button>
      </div>

      {recoveryError === null ? null : (
        <p className="form-feedback form-feedback--error" role="alert">
          {recoveryError} Ricarica per riprovare.
        </p>
      )}

      <CmoTranscript messages={messages} />
      <RecoveryComposer
        busy={busy}
        cancellationState={cancellationState}
        onCancel={requestCancellation}
        readOnly={readOnly}
      />
    </div>
  )
}

const UnavailableRecovery = ({
  events,
  onRefresh,
}: {
  readonly events: readonly MessageStreamEvent[]
  readonly onRefresh: () => void
}) => (
  <div className="cmo-console">
    <div aria-live="polite" className="cmo-status">
      <span aria-hidden="true" className="status-dot status-dot--error" />
      Recupero non disponibile
      <button className="text-button" onClick={onRefresh} type="button">
        Ricarica
      </button>
    </div>
    <p className="form-feedback form-feedback--error" role="alert">
      Lo stream non espone una sessione autorevole. Ricarica per riprovare.
    </p>
    <CmoTranscript messages={projectCmoMessages(events)} />
  </div>
)

export const CmoConsole = (props: CmoConsoleProps) => {
  const router = useRouter()
  const refresh = useCallback(() => router.refresh(), [router])

  if (!props.recoveryRequired) {
    return <InteractiveCmoConsole {...props} />
  }
  if (props.initialSession === undefined) {
    return (
      <UnavailableRecovery events={props.initialEvents} onRefresh={refresh} />
    )
  }
  return (
    <RecoveringCmoConsole {...props} initialSession={props.initialSession} />
  )
}
