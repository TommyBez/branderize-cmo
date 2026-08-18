import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { NavigationPending } from '@/components/navigation-pending'
import { getProductMarketerTask, requireBrandPageContext } from '@/lib/dal'
import { formatDateTime } from '@/lib/presentation'

export const instant = true

interface WorkDetailPageProps {
  readonly params: Promise<{
    readonly brandId: string
    readonly taskId: string
  }>
}

const WorkDetailContent = async ({ params }: WorkDetailPageProps) => {
  const { brandId, taskId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const task = await getProductMarketerTask({ access, taskId })
  if (task === null) {
    notFound()
  }

  const { completion } = task
  const hasOpenQuestions =
    completion.kind === 'valid' &&
    completion.value.status !== 'completed' &&
    task.questionResolution === null

  return (
    <div className="page-stack">
      <Link className="back-link" href={`/brands/${brandId}/work`}>
        ← Work
      </Link>
      <header className="detail-hero detail-hero--work">
        <div>
          <p className="eyebrow">Product Marketer</p>
          <h1>{task.status}</h1>
          <p className="mono-id">{task.id}</p>
        </div>
        <dl className="mini-facts">
          <div>
            <dt>Creato</dt>
            <dd>{formatDateTime(task.createdAt)}</dd>
          </div>
          <div>
            <dt>Aggiornato</dt>
            <dd>{formatDateTime(task.updatedAt)}</dd>
          </div>
          <div>
            <dt>Intent</dt>
            <dd>
              {task.intentId === null ? (
                '—'
              ) : (
                <Link href={`/brands/${brandId}/intent/${task.intentId}`}>
                  {task.intentId.slice(0, 8)} ↗
                </Link>
              )}
            </dd>
          </div>
        </dl>
      </header>

      {completion.kind === 'invalid' ? (
        <section className="read-only-note read-only-note--wide">
          <p className="eyebrow">Output non proiettabile</p>
          <h2>La completion non rispetta il contratto Phase 0.</h2>
          <p>Nessun dato parziale viene interpretato come risultato valido.</p>
        </section>
      ) : null}

      {completion.kind === 'none' ? (
        <section className="empty-state empty-state--compact">
          <p>Il task non ha ancora una completion canonica.</p>
        </section>
      ) : null}

      {completion.kind === 'valid' ? (
        <div className="task-completion">
          <section className="paper-panel">
            <p className="eyebrow">Completion · {completion.value.status}</p>
            <h2>{completion.value.summary}</h2>
            {completion.value.status === 'completed' ? (
              <Link
                className="text-link"
                href={`/brands/${brandId}/objects/${completion.value.result.brandContextObjectId}`}
              >
                Apri l’Object prodotto →
              </Link>
            ) : (
              <p className="muted">
                Motivo: {completion.value.result.reason.replaceAll('_', ' ')}
              </p>
            )}
          </section>

          {hasOpenQuestions ? (
            <aside className="question-detail">
              <p className="eyebrow">Contesto richiesto</p>
              <h2>Domande aperte</h2>
              <ol>
                {completion.value.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ol>
              <p>
                Apri una tua conversazione CMO e rispondi indicando questo task.
                La vecchia esecuzione non viene riavviata.
              </p>
              <Link
                className="button"
                href={`/brands/${brandId}/cmo?sourceTaskId=${task.id}`}
              >
                Rispondi con il CMO
              </Link>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function WorkDetailPage(props: WorkDetailPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Work ledger"
          status="Caricamento del task."
          title="Apro il lavoro tracciato."
          variant="detail"
        />
      }
    >
      <WorkDetailContent {...props} />
    </Suspense>
  )
}
