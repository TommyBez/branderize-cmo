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
    body: 'La sorgente esterna è ancora al lavoro. Le azioni restano bloccate finché il commit canonico non è concluso.',
    eyebrow: 'Import in corso',
    title: 'Il sito sta diventando contesto verificabile.',
  },
  incomplete: {
    body: 'Avvia l’import esplicito. Se la sorgente fallisce, nessun contesto viene fabbricato al suo posto.',
    eyebrow: 'Import richiesto',
    title: 'Il Brand Context non è ancora canonico.',
  },
  ready: {
    body: 'Snapshot, asset e provenienza sono leggibili come Objects prodotti dalla stessa Action.',
    eyebrow: 'Contesto pronto',
    title: 'Il brand ha una testa canonica attiva.',
  },
} as const

const staleImportCopy = {
  body: 'L’import precedente non si è concluso entro il tempo massimo. Puoi riprovare senza creare una seconda testa canonica.',
  eyebrow: 'Import interrotto',
  title: 'Il claim può essere ripreso in sicurezza.',
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
        <h1>Fonti, trasformazioni, prova.</h1>
        <p className="lede">
          Il sito di {brand.name} entra nel grafo solo dopo validazione e
          mirroring privato degli asset.
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
              Apri testa attiva
            </Link>
          )}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Object browser</p>
            <h2>Registro del contesto</h2>
          </div>
          <span>{objects.items.length} oggetti visibili</span>
        </div>

        {objects.items.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>Nessun Object è stato prodotto per questo brand.</p>
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
          status="Caricamento Brand Context."
          title="Fonti, trasformazioni, prova."
        />
      }
    >
      <ContextContent {...props} />
    </Suspense>
  )
}
