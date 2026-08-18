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
        ← All Intents
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
            <dt>Author</dt>
            <dd>{intent.author.actorKey}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDateTime(intent.updatedAt)}</dd>
          </div>
          <div>
            <dt>Origin</dt>
            <dd>{intent.parentIntentId === null ? 'Root' : 'Derived'}</dd>
          </div>
        </dl>
      </header>

      <div className="two-column-detail">
        <section className="paper-panel">
          <p className="eyebrow">Conditions</p>
          <h2>Acceptance criteria</h2>
          <ValueList
            empty="No criteria declared yet."
            value={intent.acceptanceCriteria}
          />
          <div className="rule" />
          <h2>Constraints</h2>
          <ValueList
            empty="No constraints declared yet."
            value={intent.constraints}
          />
        </section>

        {access.role === 'viewer' ? (
          <aside className="read-only-note">
            <p className="eyebrow">Read only</p>
            <h2>You can follow this Intent without changing it.</h2>
            <p>An editor or admin can publish a new revision.</p>
          </aside>
        ) : (
          <aside className="refine-panel">
            <p className="eyebrow">New revision</p>
            <h2>Refine without losing the history.</h2>
            <p>
              Each line becomes its own condition. This save does not change the
              main statement.
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
          status="Loading the Intent."
          title="Opening the Intent."
          variant="detail"
        />
      }
    >
      <IntentDetailContent {...props} />
    </Suspense>
  )
}
