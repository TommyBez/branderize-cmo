import { listBrandIntents } from '@repo/brain/projections'
import { db } from '@repo/db'
import Link from 'next/link'
import { Suspense } from 'react'
import { NavigationPending } from '@/components/navigation-pending'
import { requireBrandPageContext } from '@/lib/dal'
import { formatDateTime } from '@/lib/presentation'

export const instant = true

interface IntentIndexPageProps {
  readonly params: Promise<{ readonly brandId: string }>
}

const IntentIndexContent = async ({ params }: IntentIndexPageProps) => {
  const { brandId } = await params
  const { access, brand } = await requireBrandPageContext(brandId)
  const page = await listBrandIntents({
    access,
    database: db,
    input: { cursor: null, limit: 50, status: null },
  })

  return (
    <div className="page-stack">
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">Intent register</p>
          <h1>Il risultato prima del lavoro.</h1>
        </div>
        <div className="page-header__aside">
          <span>{brand.name}</span>
          <a href={brand.websiteUrl} rel="noopener" target="_blank">
            {new URL(brand.websiteUrl).hostname} ↗
          </a>
        </div>
      </header>

      {page.items.length === 0 ? (
        <section className="empty-state">
          <p className="eyebrow">Nessun Intent</p>
          <h2>Non esiste ancora un obiettivo canonico.</h2>
          <p>Apri il CMO per dichiararne uno attraverso un turno esplicito.</p>
          <Link className="text-link" href={`/brands/${brandId}/cmo`}>
            Vai al CMO →
          </Link>
        </section>
      ) : (
        <ol className="record-list">
          {page.items.map((intent, index) => (
            <li key={intent.id}>
              <Link href={`/brands/${brandId}/intent/${intent.id}`}>
                <span className="record-list__index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="record-list__body">
                  <span className="record-list__title">{intent.statement}</span>
                  <span className="record-list__meta">
                    {intent.status} · revisione {intent.revision} ·{' '}
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

export default function IntentIndexPage(props: IntentIndexPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Intent register"
          status="Caricamento Intent."
          title="Il risultato prima del lavoro."
        />
      }
    >
      <IntentIndexContent {...props} />
    </Suspense>
  )
}
