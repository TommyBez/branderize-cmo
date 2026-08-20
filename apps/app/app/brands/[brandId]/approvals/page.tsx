import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { Suspense } from 'react'
import {
  ApproveCommitmentForm,
  CancelCommitmentForm,
  DismissCommitmentForm,
  ReopenCommitmentForm,
} from '@/components/commitment-action-form'
import { NavigationPending } from '@/components/navigation-pending'
import {
  listBrandApprovalInbox,
  listBrandTasks,
  requireBrandPageContext,
} from '@/lib/dal'
import {
  canMutateRole,
  formatDateTime,
  statusLabel,
  taskKindLabel,
} from '@/lib/presentation'

export const instant = true

interface ApprovalsPageProps {
  readonly params: Promise<{ readonly brandId: string }>
}

const approveLabelFor = (kind: string): string => {
  if (kind === 'content.notion-page.v1') {
    return 'Approve Notion page-create'
  }
  return `Approve ${taskKindLabel(kind)}`
}

const ApprovalsContent = async ({ params }: ApprovalsPageProps) => {
  const { brandId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const [inbox, tasks] = await Promise.all([
    listBrandApprovalInbox({ access, limit: 50 }),
    listBrandTasks({ access, limit: 50 }),
  ])
  const dismissed = tasks.filter(
    (task) =>
      task.status === 'dismissed' &&
      task.activation === 'human' &&
      task.executionMode === 'direct'
  )
  const canMutate = canMutateRole(access.role)

  return (
    <div className="page-stack">
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">Approval inbox</p>
          <h1>Human attention before the work.</h1>
          <p className="lede">
            Each row has a kind-specific approve. Bulk approval is not
            available.
          </p>
        </div>
        <div className="counter-mark">
          <strong>{inbox.length}</strong>
          <span>awaiting approval</span>
        </div>
      </header>

      {inbox.length === 0 ? (
        <section className="empty-state">
          <p className="eyebrow">Clear</p>
          <h2>Nothing is awaiting approval.</h2>
          <p>Dismissed commitments stay terminal until someone reopens them.</p>
        </section>
      ) : (
        <ol className="record-list">
          {inbox.map((task) => (
            <li key={task.id}>
              <article className="paper-panel">
                <p className="eyebrow">
                  {taskKindLabel(task.kind)} · {statusLabel(task.status)}
                </p>
                <h2>
                  {task.review.kind === 'content.notion-page.v1'
                    ? task.review.title
                    : taskKindLabel(task.kind)}
                </h2>
                <p className="muted">
                  {task.id.slice(0, 8)} · revision {task.revision} ·{' '}
                  {formatDateTime(task.updatedAt)}
                </p>
                {task.review.kind === 'content.notion-page.v1' ? (
                  <p>
                    Review the Notion page-create, then approve this row only.{' '}
                    <Link
                      className="text-link"
                      href={`/brands/${brandId}/objects/${task.review.reportObjectId}`}
                    >
                      Open the Content report →
                    </Link>
                  </p>
                ) : (
                  <p>Review this commitment, then approve this row only.</p>
                )}
                {canMutate ? (
                  <div className="artifact-actions">
                    <ApproveCommitmentForm
                      brandId={brandId}
                      idleLabel={approveLabelFor(task.kind)}
                      requestId={randomUUID()}
                      revision={task.revision}
                      taskId={task.id}
                    />
                    <DismissCommitmentForm
                      brandId={brandId}
                      requestId={randomUUID()}
                      taskId={task.id}
                    />
                    <CancelCommitmentForm
                      brandId={brandId}
                      requestId={randomUUID()}
                      taskId={task.id}
                    />
                  </div>
                ) : (
                  <p className="muted">Viewers can read this inbox only.</p>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}

      {dismissed.length === 0 ? null : (
        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Dismissed</p>
              <h2>Terminal until reopen</h2>
            </div>
          </div>
          <ol className="record-list">
            {dismissed.map((task) => (
              <li key={task.id}>
                <article className="paper-panel">
                  <p className="eyebrow">
                    {taskKindLabel(task.kind)} · {statusLabel(task.status)}
                  </p>
                  <h2>{taskKindLabel(task.kind)}</h2>
                  <p className="muted">
                    {task.id.slice(0, 8)} · {formatDateTime(task.updatedAt)}
                  </p>
                  {canMutate ? (
                    <ReopenCommitmentForm
                      brandId={brandId}
                      requestId={randomUUID()}
                      taskId={task.id}
                    />
                  ) : (
                    <p className="muted">This dismissed row stays terminal.</p>
                  )}
                </article>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

export default function ApprovalsPage(props: ApprovalsPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Approval inbox"
          status="Loading approvals."
          title="Human attention before the work."
        />
      }
    >
      <ApprovalsContent {...props} />
    </Suspense>
  )
}
