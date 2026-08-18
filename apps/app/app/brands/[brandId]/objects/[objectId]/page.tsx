import { getBrandObject } from '@repo/brain/projections'
import { db } from '@repo/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { NavigationPending } from '@/components/navigation-pending'
import { requireBrandPageContext } from '@/lib/dal'
import { formatBytes, formatDateTime, readableValue } from '@/lib/presentation'

export const instant = true

interface ObjectDetailPageProps {
  readonly params: Promise<{
    readonly brandId: string
    readonly objectId: string
  }>
}

const ObjectDetailContent = async ({ params }: ObjectDetailPageProps) => {
  const { brandId, objectId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const object = await getBrandObject({
    access,
    database: db,
    input: { objectId },
  })
  if (object === null) {
    notFound()
  }

  const deliveryPath = `/api/brands/${brandId}/artifacts/${object.id}`

  return (
    <div className="page-stack">
      <Link className="back-link" href={`/brands/${brandId}/context`}>
        ← Brand Context
      </Link>
      <header className="detail-hero detail-hero--object">
        <div>
          <p className="eyebrow">Object · {object.status}</p>
          <h1>{object.singletonKey ?? object.type}</h1>
          <p className="mono-id">{object.id}</p>
        </div>
        {object.binary.kind === 'artifact' ? (
          <div className="artifact-actions">
            <a
              className="button button--quiet"
              href={`${deliveryPath}?delivery=preview`}
              rel="noopener"
              target="_blank"
            >
              Preview ↗
            </a>
            <a className="button" href={`${deliveryPath}?delivery=download`}>
              Download
            </a>
          </div>
        ) : null}
      </header>

      <div className="provenance-grid">
        <section className="paper-panel paper-panel--content">
          <p className="eyebrow">Record content</p>
          <pre>{readableValue(object.content)}</pre>
        </section>
        <aside className="provenance-rail">
          <p className="eyebrow">Source</p>
          <dl className="provenance-list">
            <div>
              <dt>Action</dt>
              <dd>{object.producedBy.type}</dd>
              <dd className="mono-id">{object.producedBy.id}</dd>
            </div>
            <div>
              <dt>Actor</dt>
              <dd>{object.producedBy.actor.actorKey}</dd>
              <dd>{object.producedBy.actor.type}</dd>
            </div>
            <div>
              <dt>Rationale</dt>
              <dd>{object.producedBy.rationale}</dd>
            </div>
            <div>
              <dt>Effect</dt>
              <dd>{object.producedBy.effectClass}</dd>
            </div>
            <div>
              <dt>Produced</dt>
              <dd>{formatDateTime(object.createdAt)}</dd>
            </div>
            {object.binary.kind === 'artifact' ? (
              <>
                <div>
                  <dt>Format</dt>
                  <dd>{object.binary.contentType}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(object.binary.byteSize)}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd className="hash">{object.binary.sha256}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </aside>
      </div>
    </div>
  )
}

export default function ObjectDetailPage(props: ObjectDetailPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Object"
          status="Loading the Object."
          title="Opening the record."
          variant="detail"
        />
      }
    >
      <ObjectDetailContent {...props} />
    </Suspense>
  )
}
