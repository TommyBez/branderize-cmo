import { getBrandImportStatus, listBrandObjects } from '@repo/brain/projections'
import { db } from '@repo/db'
import Link from 'next/link'
import { Suspense } from 'react'
import { ContextImportForm } from '@/components/context-import-form'
import { NavigationPending } from '@/components/navigation-pending'
import { requireBrandPageContext } from '@/lib/dal'
import { formatDateTime } from '@/lib/presentation'

const statusCopy = {
  importing: {
    body: 'The external source is still working. Actions stay locked until this import finishes.',
    eyebrow: 'Import in progress',
    title: 'The site is becoming Brand Context.',
  },
  incomplete: {
    body: 'Start the import. If the source fails, nothing is invented in its place.',
    eyebrow: 'Import required',
    title: 'The site is not in Brand Context yet.',
  },
  ready: {
    body: 'The snapshot, assets, and source are readable as Objects from the same Action.',
    eyebrow: 'Context ready',
    title: 'The brand has an active Brand Context.',
  },
} as const

const staleImportCopy = {
  body: 'The previous import timed out. You can retry without creating a second current record.',
  eyebrow: 'Import interrupted',
  title: 'The claim can be resumed safely.',
} as const

export const instant = true

interface ContextPageProps {
  readonly params: Promise<{ readonly brandId: string }>
}

const ContextContent = async ({ params }: ContextPageProps) => {
  const { brandId } = await params
  const { access, brand } = await requireBrandPageContext(brandId)
  const [status, objects] = await Promise.all([
    getBrandImportStatus({ access, database: db }),
    listBrandObjects({
      access,
      database: db,
      input: { cursor: null, limit: 75, status: null, type: null },
    }),
  ])
  const copy =
    status.kind === 'importing' && status.retryAvailable
      ? staleImportCopy
      : statusCopy[status.kind]
  const statusMark = {
    importing: '…',
    incomplete: '○',
    ready: '✓',
  }[status.kind]

  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="eyebrow">Brand Context</p>
        <h1>Sources, then proof.</h1>
        <p className="lede">
          The {brand.name} site enters the brand only after it is validated and
          its assets are copied privately.
        </p>
      </header>

      <section className={`import-status import-status--${status.kind}`}>
        <div aria-hidden="true" className="import-status__mark">
          {statusMark}
        </div>
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
          <a href={brand.websiteUrl} rel="noopener" target="_blank">
            {brand.websiteUrl} ↗
          </a>
        </div>
        <div className="import-status__action">
          {status.retryAvailable && access.role !== 'viewer' ? (
            <ContextImportForm brandId={brandId} />
          ) : null}
          {status.currentBrandContextObjectId === null ? null : (
            <Link
              className="button button--quiet"
              href={`/brands/${brandId}/objects/${status.currentBrandContextObjectId}`}
            >
              Open current record
            </Link>
          )}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Object browser</p>
            <h2>Context register</h2>
          </div>
          <span>
            {objects.items.length} visible object
            {objects.items.length === 1 ? '' : 's'}
          </span>
        </div>

        {objects.items.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>No Objects have been produced for this brand.</p>
          </div>
        ) : (
          <div className="object-grid">
            {objects.items.map((object) => (
              <Link
                className="object-card"
                href={`/brands/${brandId}/objects/${object.id}`}
                key={object.id}
              >
                <span className="object-card__type">{object.type}</span>
                <strong>
                  {object.singletonKey ??
                    (object.binary.kind === 'artifact'
                      ? object.binary.contentType
                      : object.id.slice(0, 8))}
                </strong>
                <span>{object.status}</span>
                <time dateTime={object.createdAt.toISOString()}>
                  {formatDateTime(object.createdAt)}
                </time>
                <span aria-hidden="true" className="object-card__arrow">
                  ↗
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default function ContextPage(props: ContextPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Brand Context"
          status="Loading Brand Context."
          title="Sources, then proof."
        />
      }
    >
      <ContextContent {...props} />
    </Suspense>
  )
}
