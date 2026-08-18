import type { EveMessage } from 'eve/client'

export const CmoMessage = ({ message }: { readonly message: EveMessage }) => (
  <article className={`chat-message chat-message--${message.role}`}>
    <header>{message.role === 'assistant' ? 'CMO' : 'Tu'}</header>
    <div>
      {message.parts.map((part) => {
        if (part.type === 'text') {
          return (
            <p key={`${message.id}:text:${part.stepIndex ?? 'received'}`}>
              {part.text}
            </p>
          )
        }
        if (part.type === 'dynamic-tool') {
          return (
            <p className="tool-state" key={part.toolCallId}>
              {part.toolName} · {part.state.replaceAll('-', ' ')}
            </p>
          )
        }
        if (part.type === 'authorization') {
          return (
            <p
              className="tool-state"
              key={`${message.id}:auth:${part.turnId}:${part.name}`}
            >
              {part.displayName} · {part.state}
            </p>
          )
        }
        return null
      })}
    </div>
  </article>
)
