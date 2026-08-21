import { listBrandIntentProposals } from '@repo/brain/projections'
import { db } from '@repo/db'
import Link from 'next/link'
import { Suspense } from 'react'
import { NavigationPending } from '@/components/navigation-pending'
import { requireBrandPageContext } from '@/lib/dal'
import { formatDateTime } from '@/lib/presentation'

export const instant = true

interface IntentProposalsPageProps {
  readonly params: Promise<{ readonly brandId: string }>
}

const IntentProposalsContent = async ({ params }: IntentProposalsPageProps) => {
  const { brandId } = await params
  const { access, brand } = await requireBrandPageContext(brandId)
  const page = await listBrandIntentProposals({
    access,
    database: db,
    input: { cursor: null, limit: 50 },
  })

  return (
    <div className="page-stack">
      <Link className="back-link" href={`/brands/${brandId}/intent`}>
        ← Intent register
      </Link>
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">Intent proposals</p>
          <h1>Drafts stay off the register.</h1>
          <p className="lede">
            Adopt a draft to put it on the register. Viewers can read without
            changing it.
          </p>
        </div>
        <div className="page-header__aside">
          <span>{brand.name}</span>
          <span>{access.role}</span>
        </div>
      </header>

      {page.items.length === 0 ? (
        <section className="empty-state">
          <p className="eyebrow">No proposals</p>
          <h2>There is no draft Intent.</h2>
          <p>The CMO can propose one in an explicit turn.</p>
        </section>
      ) : (
        <ol className="record-list">
          {page.items.map((intent, index) => (
            <li key={intent.id}>
              <Link href={`/brands/${brandId}/intent/proposals/${intent.id}`}>
                <span className="record-list__index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="record-list__body">
                  <span className="record-list__title">{intent.statement}</span>
                  <span className="record-list__meta">
                    {intent.status} · revision {intent.revision} ·{' '}
                    {formatDateTime(intent.updatedAt)}
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
    </div>
  )
}

export default function IntentProposalsPage(props: IntentProposalsPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Intent proposals"
          status="Loading proposals."
          title="Drafts stay off the register."
        />
      }
    >
      <IntentProposalsContent {...props} />
    </Suspense>
  )
}
