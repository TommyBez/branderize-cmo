import { listCmoConversations } from '@repo/brain/conversations'
import { db } from '@repo/db'
import Link from 'next/link'
import { Suspense } from 'react'
import { ConversationForm } from '@/components/conversation-form'
import { NavigationPending } from '@/components/navigation-pending'
import { authorizeCmoSourceTaskClaim } from '@/lib/cmo'
import { requireBrandPageContext } from '@/lib/dal'
import { formatDateTime } from '@/lib/presentation'

export const instant = true

interface CmoIndexPageProps {
  readonly params: Promise<{ readonly brandId: string }>
  readonly searchParams: Promise<{
    readonly sourceTaskId?: string | string[]
  }>
}

const CmoIndexContent = async ({ params, searchParams }: CmoIndexPageProps) => {
  const { brandId } = await params
  const query = await searchParams
  const { access } = await requireBrandPageContext(brandId)
  const conversations = await listCmoConversations({
    access,
    database: db,
    input: { cursor: null, includeArchived: false, limit: 50 },
  })
  const requestedSourceTaskId =
    typeof query.sourceTaskId === 'string' ? query.sourceTaskId : null
  const sourceTaskId =
    requestedSourceTaskId === null
      ? null
      : await authorizeCmoSourceTaskClaim({
          access,
          sourceTaskId: requestedSourceTaskId,
        })
  const sourceTaskSearch =
    sourceTaskId === null
      ? ''
      : `?sourceTaskId=${encodeURIComponent(sourceTaskId)}`

  return (
    <div className="page-stack">
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">Private CMO</p>
          <h1>Uno spazio solo tuo, dentro il brand.</h1>
          <p className="lede">
            Gli Intent e gli Objects sono leggibili dall’organizzazione. Queste
            conversazioni appartengono invece soltanto al loro proprietario.
          </p>
        </div>
        <div className="privacy-mark">
          <span aria-hidden="true">◒</span>
          Owner-private
        </div>
      </header>

      {sourceTaskId === null ? null : (
        <aside className="context-note">
          <p className="eyebrow">Contesto da Work</p>
          <p>
            Il prossimo turno può attestare il task <code>{sourceTaskId}</code>.
            L’attestazione viene rivalidata prima dell’invio e vale per un solo
            turno.
          </p>
        </aside>
      )}

      {access.role === 'viewer' ? (
        <aside className="read-only-note read-only-note--wide">
          <p className="eyebrow">Viewer</p>
          <p>
            Puoi rileggere le conversazioni che possiedi, ma non aprirne o
            inviarne di nuove con il ruolo corrente.
          </p>
        </aside>
      ) : (
        <section className="new-conversation">
          <ConversationForm brandId={brandId} sourceTaskId={sourceTaskId} />
        </section>
      )}

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Il tuo archivio</p>
            <h2>Conversazioni</h2>
          </div>
          <span>{conversations.items.length} private</span>
        </div>
        {conversations.items.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>Non hai ancora una conversazione per questo brand.</p>
          </div>
        ) : (
          <ol className="record-list">
            {conversations.items.map((conversation, index) => (
              <li key={conversation.id}>
                <Link
                  href={`/brands/${brandId}/cmo/${conversation.id}${sourceTaskSearch}`}
                >
                  <span className="record-list__index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="record-list__body">
                    <span className="record-list__title">
                      {conversation.title ?? 'Conversazione senza titolo'}
                    </span>
                    <span className="record-list__meta">
                      {conversation.session.kind === 'bound'
                        ? 'sessione collegata'
                        : 'non ancora avviata'}{' '}
                      · {formatDateTime(conversation.updatedAt)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="record-list__arrow">
                    ↗
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

export default function CmoIndexPage(props: CmoIndexPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Private CMO"
          status="Caricamento CMO."
          title="Uno spazio solo tuo, dentro il brand."
        />
      }
    >
      <CmoIndexContent {...props} />
    </Suspense>
  )
}
