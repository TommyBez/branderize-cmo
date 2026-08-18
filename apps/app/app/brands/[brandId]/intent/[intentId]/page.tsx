import { randomUUID } from 'node:crypto'
import { getBrandIntent } from '@repo/brain/projections'
import { db } from '@repo/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { NavigationPending } from '@/components/navigation-pending'
import { RefineIntentForm } from '@/components/refine-intent-form'
import { requireBrandPageContext } from '@/lib/dal'
import { formatDateTime, lines, stringList } from '@/lib/presentation'

const ValueList = ({
  empty,
  value,
}: {
  readonly empty: string
  readonly value: unknown
}) => {
  const items = stringList(value)
  return items.length === 0 ? (
    <p className="muted">{empty}</p>
  ) : (
    <ul className="detail-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export const instant = true

interface IntentDetailPageProps {
  readonly params: Promise<{
    readonly brandId: string
    readonly intentId: string
  }>
}

const IntentDetailContent = async ({ params }: IntentDetailPageProps) => {
  const { brandId, intentId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const intent = await getBrandIntent({
    access,
    database: db,
    input: { intentId },
  })
  if (intent === null) {
    notFound()
  }

  return (
    <div className="page-stack">
      <Link className="back-link" href={`/brands/${brandId}/intent`}>
        ← Tutti gli Intent
      </Link>
      <header className="detail-hero">
        <div>
          <p className="eyebrow">
            {intent.status} · r{intent.revision}
          </p>
          <h1>{intent.statement}</h1>
        </div>
        <dl className="mini-facts">
          <div>
            <dt>Autore</dt>
            <dd>{intent.author.actorKey}</dd>
          </div>
          <div>
            <dt>Aggiornato</dt>
            <dd>{formatDateTime(intent.updatedAt)}</dd>
          </div>
          <div>
            <dt>Origine</dt>
            <dd>{intent.parentIntentId === null ? 'Root' : 'Derivato'}</dd>
          </div>
        </dl>
      </header>

      <div className="two-column-detail">
        <section className="paper-panel">
          <p className="eyebrow">Condizioni</p>
          <h2>Criteri di accettazione</h2>
          <ValueList
            empty="Nessun criterio ancora dichiarato."
            value={intent.acceptanceCriteria}
          />
          <div className="rule" />
          <h2>Vincoli</h2>
          <ValueList
            empty="Nessun vincolo ancora dichiarato."
            value={intent.constraints}
          />
        </section>

        {access.role === 'viewer' ? (
          <aside className="read-only-note">
            <p className="eyebrow">Sola lettura</p>
            <h2>Puoi seguire questo Intent senza modificarlo.</h2>
            <p>Un membro editor o admin può pubblicare una nuova revisione.</p>
          </aside>
        ) : (
          <aside className="refine-panel">
            <p className="eyebrow">Nuova revisione</p>
            <h2>Raffina senza perdere la storia.</h2>
            <p>
              Ogni riga diventa una condizione distinta. Il testo principale
              resta invariato in questa operazione.
            </p>
            <RefineIntentForm
              acceptanceCriteria={lines(intent.acceptanceCriteria)}
              brandId={brandId}
              constraints={lines(intent.constraints)}
              intentId={intent.id}
              requestId={randomUUID()}
              revision={intent.revision}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

export default function IntentDetailPage(props: IntentDetailPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Intent"
          status="Caricamento del dettaglio Intent."
          title="Apro l'Intent."
          variant="detail"
        />
      }
    >
      <IntentDetailContent {...props} />
    </Suspense>
  )
}
