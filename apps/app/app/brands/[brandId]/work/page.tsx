import Link from 'next/link'
import { Suspense } from 'react'
import { NavigationPending } from '@/components/navigation-pending'
import { WorkRefresh } from '@/components/work-refresh'
import { listBrandTasks, requireBrandPageContext } from '@/lib/dal'
import {
  formatDateTime,
  isActiveWorkStatus,
  statusLabel,
  taskKindLabel,
} from '@/lib/presentation'

export const instant = true

interface WorkIndexPageProps {
  readonly params: Promise<{ readonly brandId: string }>
}

const WorkIndexContent = async ({ params }: WorkIndexPageProps) => {
  const { brandId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const tasks = await listBrandTasks({ access, limit: 50 })
  const pollingStatus =
    tasks.find((task) => isActiveWorkStatus(task.status))?.status ?? 'succeeded'

  return (
    <div className="page-stack">
      <WorkRefresh status={pollingStatus} />
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">Work ledger</p>
          <h1>Work leaves a receipt.</h1>
          <p className="lede">
            Content, Distribution, SEO, and commitment rows sit with Product
            Marketer. Awaiting approval is human attention, not active work.
          </p>
        </div>
        <div className="counter-mark">
          <strong>{tasks.length}</strong>
          <span>recent tasks</span>
        </div>
      </header>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Every kind</p>
            <h2>Recent tasks</h2>
          </div>
          <Link className="text-link" href={`/brands/${brandId}/approvals`}>
            Approval inbox →
          </Link>
        </div>
        {tasks.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>
              No tasks yet. The CMO can send specialist work only from one
              active, unambiguous Intent.
            </p>
          </div>
        ) : (
          <ol className="record-list record-list--work">
            {tasks.map((task, index) => (
              <li key={task.id}>
                <Link href={`/brands/${brandId}/work/${task.id}`}>
                  <span className="record-list__index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="record-list__body">
                    <span className="record-list__title">
                      {taskKindLabel(task.kind)} · {statusLabel(task.status)}
                    </span>
                    <span className="record-list__meta">
                      {task.id.slice(0, 8)} · {formatDateTime(task.updatedAt)}
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
      </section>
    </div>
  )
}

export default function WorkIndexPage(props: WorkIndexPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Work ledger"
          status="Loading Work."
          title="Work leaves a receipt."
        />
      }
    >
      <WorkIndexContent {...props} />
    </Suspense>
  )
}
