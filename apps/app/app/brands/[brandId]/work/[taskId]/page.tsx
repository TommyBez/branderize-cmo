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
            <dt>Created</dt>
            <dd>{formatDateTime(task.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
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
          <p className="eyebrow">Output cannot be shown</p>
          <h2>This completion does not match the current contract.</h2>
          <p>Partial data is never treated as a valid result.</p>
        </section>
      ) : null}

      {completion.kind === 'none' ? (
        <section className="empty-state empty-state--compact">
          <p>This task has no completion yet.</p>
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
                Open the produced Object →
              </Link>
            ) : (
              <p className="muted">
                Reason: {completion.value.result.reason.replaceAll('_', ' ')}
              </p>
            )}
          </section>

          {hasOpenQuestions ? (
            <aside className="question-detail">
              <p className="eyebrow">Context needed</p>
              <h2>Open questions</h2>
              <ol>
                {completion.value.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ol>
              <p>
                Open your own CMO conversation and answer with this task
                attached. The old run is not restarted.
              </p>
              <Link
                className="button"
                href={`/brands/${brandId}/cmo?sourceTaskId=${task.id}`}
              >
                Answer with the CMO
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
          status="Loading the task."
          title="Opening the work."
          variant="detail"
        />
      }
    >
      <WorkDetailContent {...props} />
    </Suspense>
  )
}
