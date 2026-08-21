import { randomUUID } from 'node:crypto'
import { getBrandIntent } from '@repo/brain/projections'
import { db } from '@repo/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import {
  AbandonIntentForm,
  AdoptIntentForm,
} from '@/components/intent-lifecycle-form'
import { NavigationPending } from '@/components/navigation-pending'
import { requireBrandPageContext } from '@/lib/dal'
import { canMutateRole, formatDateTime, stringList } from '@/lib/presentation'

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

interface IntentProposalDetailPageProps {
  readonly params: Promise<{
    readonly brandId: string
    readonly intentId: string
  }>
}

const IntentProposalDetailContent = async ({
  params,
}: IntentProposalDetailPageProps) => {
  const { brandId, intentId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const intent = await getBrandIntent({
    access,
    database: db,
    input: { intentId },
  })
  if (intent === null || intent.status !== 'draft') {
    notFound()
  }
  const canMutate = canMutateRole(access.role)

  return (
    <div className="page-stack">
      <Link className="back-link" href={`/brands/${brandId}/intent/proposals`}>
        ← All proposals
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

        {canMutate ? (
          <aside className="refine-panel">
            <p className="eyebrow">Proposal</p>
            <h2>Adopt or abandon this draft.</h2>
            <p>Adoption puts it on the register. Abandon keeps the history.</p>
            <AdoptIntentForm
              brandId={brandId}
              intentId={intent.id}
              requestId={randomUUID()}
              revision={intent.revision}
            />
            <AbandonIntentForm
              brandId={brandId}
              intentId={intent.id}
              requestId={randomUUID()}
              revision={intent.revision}
            />
          </aside>
        ) : (
          <aside className="read-only-note">
            <p className="eyebrow">Read only</p>
            <h2>You can read this proposal without changing it.</h2>
            <p>An owner, admin, or member can adopt or abandon it.</p>
          </aside>
        )}
      </div>
    </div>
  )
}

export default function IntentProposalDetailPage(
  props: IntentProposalDetailPageProps
) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Proposed Intent"
          status="Loading the proposal."
          title="Opening the proposal."
          variant="detail"
        />
      }
    >
      <IntentProposalDetailContent {...props} />
    </Suspense>
  )
}
