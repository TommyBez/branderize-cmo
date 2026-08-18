import type { EveMessage, MessageStreamEvent } from 'eve/client'

import { projectCmoMessages } from '@/lib/cmo-recovery'
import type { CancellationState } from './cmo-console-types'
import { CmoMessage } from './cmo-message'

export const CmoTranscript = ({
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

export const RecoveryComposer = ({
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

export const RecoveryAuditFallback = ({
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

export const UnavailableRecovery = ({
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
