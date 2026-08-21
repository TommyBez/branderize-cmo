import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import {
  CancelCommitmentForm,
  DismissCommitmentForm,
  ReopenCommitmentForm,
} from '@/components/commitment-action-form'
import { NavigationPending } from '@/components/navigation-pending'
import { WorkRefresh } from '@/components/work-refresh'
import { getBrandTask, requireBrandPageContext } from '@/lib/dal'
import {
  canMutateRole,
  formatDateTime,
  statusLabel,
  taskKindLabel,
} from '@/lib/presentation'

export const instant = true

interface WorkDetailPageProps {
  readonly params: Promise<{
    readonly brandId: string
    readonly taskId: string
  }>
}

const ProvenanceBlock = ({
  label,
  provenance,
}: {
  readonly label: string
  readonly provenance: {
    readonly actorKey: string
    readonly createdAt: Date
    readonly id: string
    readonly rationale: string
    readonly type: string
  } | null
}) => {
  if (provenance === null) {
    return (
      <section className="paper-panel">
        <p className="eyebrow">{label}</p>
        <p className="muted">No {label.toLowerCase()} Action yet.</p>
      </section>
    )
  }

  return (
    <section className="paper-panel">
      <p className="eyebrow">{label}</p>
      <h2>{provenance.type.replaceAll('_', ' ')}</h2>
      <dl className="provenance-list">
        <div>
          <dt>Action</dt>
          <dd>{provenance.id}</dd>
        </div>
        <div>
          <dt>Actor</dt>
          <dd>{provenance.actorKey}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{formatDateTime(provenance.createdAt)}</dd>
        </div>
        <div>
          <dt>Rationale</dt>
          <dd>{provenance.rationale}</dd>
        </div>
      </dl>
    </section>
  )
}

const CompletionResultNote = ({
  brandId,
  completion,
}: {
  readonly brandId: string
  readonly completion: NonNullable<
    Awaited<ReturnType<typeof getBrandTask>>
  >['completion']
}) => {
  if (completion.kind !== 'valid') {
    return null
  }

  if (completion.value.status !== 'completed') {
    return (
      <p className="muted">
        Reason: {completion.value.result.reason.replaceAll('_', ' ')}
      </p>
    )
  }

  if ('brandContextObjectId' in completion.value.result) {
    return (
      <Link
        className="text-link"
        href={`/brands/${brandId}/objects/${completion.value.result.brandContextObjectId}`}
      >
        Open the produced Object →
      </Link>
    )
  }

  return <p className="muted">Completed without an Object link.</p>
}

const WorkCompletionSection = ({
  brandId,
  completion,
  hasOpenQuestions,
  taskId,
}: {
  readonly brandId: string
  readonly completion: NonNullable<
    Awaited<ReturnType<typeof getBrandTask>>
  >['completion']
  readonly hasOpenQuestions: boolean
  readonly taskId: string
}) => {
  if (completion.kind === 'invalid') {
    return (
      <section className="read-only-note read-only-note--wide">
        <p className="eyebrow">Output cannot be shown</p>
        <h2>This completion does not match the current contract.</h2>
        <p>Partial data is never treated as a valid result.</p>
      </section>
    )
  }

  if (completion.kind === 'none') {
    return (
      <section className="empty-state empty-state--compact">
        <p>This task has no completion yet.</p>
      </section>
    )
  }

  if (completion.kind === 'summary') {
    return (
      <section className="paper-panel">
        <p className="eyebrow">Completion</p>
        <h2>{completion.summary}</h2>
      </section>
    )
  }

  return (
    <div className="task-completion">
      <section className="paper-panel">
        <p className="eyebrow">Completion · {completion.value.status}</p>
        <h2>{completion.value.summary}</h2>
        <CompletionResultNote brandId={brandId} completion={completion} />
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
            Open your own CMO conversation and answer with this task attached.
            The old run is not restarted.
          </p>
          <Link
            className="button"
            href={`/brands/${brandId}/cmo?sourceTaskId=${taskId}`}
          >
            Answer with the CMO
          </Link>
        </aside>
      ) : null}
    </div>
  )
}

const CommitmentActions = ({
  brandId,
  status,
  taskId,
}: {
  readonly brandId: string
  readonly status: string
  readonly taskId: string
}) => (
  <aside className="refine-panel">
    <p className="eyebrow">Commitment</p>
    <h2>Dismiss, reopen, or cancel this row.</h2>
    {status === 'awaiting_approval' ? (
      <div className="artifact-actions">
        <DismissCommitmentForm
          brandId={brandId}
          requestId={randomUUID()}
          taskId={taskId}
        />
        <CancelCommitmentForm
          brandId={brandId}
          requestId={randomUUID()}
          taskId={taskId}
        />
      </div>
    ) : null}
    {status === 'dismissed' ? (
      <ReopenCommitmentForm
        brandId={brandId}
        requestId={randomUUID()}
        taskId={taskId}
      />
    ) : null}
    {status === 'queued' ? (
      <CancelCommitmentForm
        brandId={brandId}
        requestId={randomUUID()}
        taskId={taskId}
      />
    ) : null}
  </aside>
)

const WorkDetailContent = async ({ params }: WorkDetailPageProps) => {
  const { brandId, taskId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const task = await getBrandTask({ access, taskId })
  if (task === null) {
    notFound()
  }

  const { completion } = task
  const isProductMarketer = task.kind === 'product-marketer.brand-context.v1'
  const hasOpenQuestions =
    isProductMarketer &&
    completion.kind === 'valid' &&
    completion.value.status !== 'completed' &&
    task.questionResolution === null
  const isHumanCommitment =
    task.activation === 'human' && task.executionMode === 'direct'
  const canMutate = canMutateRole(access.role)

  return (
    <div className="page-stack">
      <WorkRefresh status={task.status} />
      <Link className="back-link" href={`/brands/${brandId}/work`}>
        ← Work
      </Link>
      <header className="detail-hero detail-hero--work">
        <div>
          <p className="eyebrow">{taskKindLabel(task.kind)}</p>
          <h1>{statusLabel(task.status)}</h1>
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

      <WorkCompletionSection
        brandId={brandId}
        completion={completion}
        hasOpenQuestions={hasOpenQuestions}
        taskId={task.id}
      />

      {isHumanCommitment ? (
        <div className="two-column-detail">
          <ProvenanceBlock label="Approval" provenance={task.approval} />
          <ProvenanceBlock label="Result" provenance={task.result} />
        </div>
      ) : null}

      {isHumanCommitment && canMutate ? (
        <CommitmentActions
          brandId={brandId}
          status={task.status}
          taskId={task.id}
        />
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
