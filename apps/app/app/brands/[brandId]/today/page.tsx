import { readBrandConnectionCapabilities } from '@repo/brain/connections'
import { listBrandIntentProposals } from '@repo/brain/projections'
import { db } from '@repo/db'
import Link from 'next/link'
import { Suspense } from 'react'
import { NavigationPending } from '@/components/navigation-pending'
import {
  listBrandApprovalInbox,
  listBrandTasks,
  requireBrandPageContext,
} from '@/lib/dal'
import {
  connectionSlotLabel,
  formatDateTime,
  isActiveWorkStatus,
  statusLabel,
  taskKindLabel,
} from '@/lib/presentation'

export const instant = true

interface TodayPageProps {
  readonly params: Promise<{ readonly brandId: string }>
}

const TodayContent = async ({ params }: TodayPageProps) => {
  const { brandId } = await params
  const { access, brand } = await requireBrandPageContext(brandId)
  const [proposals, approvals, tasks, connections] = await Promise.all([
    listBrandIntentProposals({
      access,
      database: db,
      input: { cursor: null, limit: 8 },
    }),
    listBrandApprovalInbox({ access, limit: 8 }),
    listBrandTasks({ access, limit: 20 }),
    readBrandConnectionCapabilities({ access, database: db }),
  ])
  const activeWork = tasks.filter((task) => isActiveWorkStatus(task.status))
  const connectionSlots = [
    { capability: connections.notion, slot: 'notion' as const },
    { capability: connections.typefully, slot: 'typefully' as const },
  ]
  const missingSlots = connectionSlots.filter(
    (item) => item.capability.kind === 'missing'
  )

  return (
    <div className="page-stack">
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">Today</p>
          <h1>What needs attention.</h1>
          <p className="lede">
            Drafts stay off the register. Approvals, Work, and Connections are
            real pages. Provider secrets never enter the graph.
          </p>
        </div>
        <div className="page-header__aside">
          <span>{brand.name}</span>
          <a href={brand.websiteUrl} rel="noopener" target="_blank">
            {new URL(brand.websiteUrl).hostname} ↗
          </a>
        </div>
      </header>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Intent proposals</p>
            <h2>Drafts waiting to be adopted</h2>
          </div>
          <Link
            className="text-link"
            href={`/brands/${brandId}/intent/proposals`}
          >
            Open proposals →
          </Link>
        </div>
        {proposals.items.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>No draft Intents. The register still holds settled work.</p>
          </div>
        ) : (
          <ol className="record-list">
            {proposals.items.map((intent, index) => (
              <li key={intent.id}>
                <Link href={`/brands/${brandId}/intent/proposals/${intent.id}`}>
                  <span className="record-list__index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="record-list__body">
                    <span className="record-list__title">
                      {intent.statement}
                    </span>
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
      </section>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Approvals</p>
            <h2>Human attention before the work</h2>
          </div>
          <Link className="text-link" href={`/brands/${brandId}/approvals`}>
            Open inbox →
          </Link>
        </div>
        {approvals.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>Nothing is awaiting approval.</p>
          </div>
        ) : (
          <ol className="record-list record-list--work">
            {approvals.map((task, index) => (
              <li key={task.id}>
                <Link href={`/brands/${brandId}/approvals`}>
                  <span className="record-list__index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="record-list__body">
                    <span className="record-list__title">
                      {taskKindLabel(task.kind)} · {statusLabel(task.status)}
                    </span>
                    <span className="record-list__meta">
                      {task.review.kind === 'content.notion-page.v1'
                        ? task.review.title
                        : task.id.slice(0, 8)}{' '}
                      · {formatDateTime(task.updatedAt)}
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

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Work</p>
            <h2>Queued or running</h2>
          </div>
          <Link className="text-link" href={`/brands/${brandId}/work`}>
            Open Work →
          </Link>
        </div>
        {activeWork.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>
              No active work. Awaiting approval is human attention, not a
              running task.
            </p>
          </div>
        ) : (
          <ol className="record-list record-list--work">
            {activeWork.map((task, index) => (
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

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Connections</p>
            <h2>Provider slots</h2>
          </div>
          <Link className="text-link" href={`/brands/${brandId}/connections`}>
            Open Connections →
          </Link>
        </div>
        {missingSlots.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>Notion and Typefully are both granted.</p>
          </div>
        ) : (
          <div className="empty-state empty-state--compact">
            <p>
              Missing:{' '}
              {missingSlots
                .map((item) => connectionSlotLabel(item.slot))
                .join(' and ')}
              . Secrets stay outside the graph.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

export default function TodayPage(props: TodayPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Today"
          status="Loading Today."
          title="What needs attention."
        />
      }
    >
      <TodayContent {...props} />
    </Suspense>
  )
}
