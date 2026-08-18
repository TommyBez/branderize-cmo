import type { EveMessage } from 'eve/client'

import { CmoMessage } from './cmo-message'

export const CmoReadOnly = ({
  messages,
}: {
  readonly messages: readonly EveMessage[]
}) => (
  <div className="cmo-console cmo-console--readonly">
    <div className="read-only-banner">
      <p className="eyebrow">Runtime non raggiungibile</p>
      <strong>La proiezione resta disponibile in sola lettura.</strong>
      <p>Nessun runtime locale o transcript inventato sostituisce il CMO.</p>
    </div>
    <div className="chat-transcript">
      {messages.length === 0 ? (
        <div className="chat-empty">
          <h2>Nessun messaggio audit disponibile.</h2>
          <p>Riprova quando l’endpoint CMO è configurato e raggiungibile.</p>
        </div>
      ) : (
        messages.map((message) => (
          <CmoMessage key={message.id} message={message} />
        ))
      )}
    </div>
  </div>
)
