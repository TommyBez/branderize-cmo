import type { EveMessage } from 'eve/client'

import { CmoMessage } from './cmo-message'

export const CmoReadOnly = ({
  messages,
}: {
  readonly messages: readonly EveMessage[]
}) => (
  <div className="cmo-console cmo-console--readonly">
    <div className="read-only-banner">
      <p className="eyebrow">Runtime unreachable</p>
      <strong>The projection stays available as read-only.</strong>
      <p>No local runtime or invented transcript stands in for the CMO.</p>
    </div>
    <div className="chat-transcript">
      {messages.length === 0 ? (
        <div className="chat-empty">
          <h2>No audit messages available.</h2>
          <p>Try again when the CMO endpoint is configured and reachable.</p>
        </div>
      ) : (
        messages.map((message) => (
          <CmoMessage key={message.id} message={message} />
        ))
      )}
    </div>
  </div>
)
