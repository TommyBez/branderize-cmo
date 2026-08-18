import type { ClientSessionState, EveMessage } from 'eve/client'
import { Client } from 'eve/client'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { readCmoAuditFallbackAction } from '@/lib/actions'
import {
  projectCmoMessages,
  type RecoveredCmoSession,
  recoverCmoSessionToCurrentTurnBoundary,
} from '@/lib/cmo-recovery'
import {
  activeTurnFrom,
  type CancellationState,
  type InteractiveCmoConsoleProps,
} from './cmo-console-types'
import {
  CmoTranscript,
  RecoveryAuditFallback,
  RecoveryComposer,
} from './cmo-console-view'
import { InteractiveCmoConsole } from './interactive-cmo-console'

export const RecoveringCmoConsole = ({
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
            setRecoveryError('Stream recovery could not be completed.')
          }
        }
      }
    }

    recover().catch(() => {
      if (!controller.signal.aborted) {
        setRecoveryError('Stream recovery could not be completed.')
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
      setRecoveryError('This turn could not be stopped.')
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
        {busy ? 'CMO at work' : 'Recovering session'}
        <button className="text-button" onClick={refresh} type="button">
          Reload
        </button>
      </div>

      {recoveryError === null ? null : (
        <p className="form-feedback form-feedback--error" role="alert">
          {recoveryError} Reload to try again.
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
