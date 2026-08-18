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
        <p className="eyebrow">Private conversation</p>
        <h2>Start from an outcome, not a task list.</h2>
        <p>
          The CMO can declare or refine an Intent, or ask Product Marketer to
          work, when your turn names one active goal.
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
      Message to the CMO
    </label>
    <textarea
      disabled
      id="cmo-message"
      placeholder={
        readOnly
          ? 'This conversation is read-only.'
          : 'The current turn is recovering…'
      }
      rows={3}
    />
    <div className="cmo-composer__actions">
      <small>
        The transcript is being aligned to the authoritative stream.
      </small>
      {busy ? (
        <button
          className="button button--quiet"
          disabled={cancellationState !== 'idle'}
          onClick={onCancel}
          type="button"
        >
          {cancellationState === 'idle' ? 'Stop turn' : 'Stopping…'}
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
      <p className="eyebrow">Runtime recovery interrupted</p>
      <strong>The saved projection is still available.</strong>
      <p>The audit prefix may be incomplete. No replacement turn was sent.</p>
      <button className="text-button" onClick={onRetry} type="button">
        Retry recovery
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
      Recovery unavailable
      <button className="text-button" onClick={onRefresh} type="button">
        Reload
      </button>
    </div>
    <p className="form-feedback form-feedback--error" role="alert">
      The stream does not expose an authoritative session. Reload to try again.
    </p>
    <CmoTranscript messages={projectCmoMessages(events)} />
  </div>
)
