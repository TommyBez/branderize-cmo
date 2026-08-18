import Link from 'next/link'
import { Suspense } from 'react'
import { NavigationPending } from '@/components/navigation-pending'
import { listProductMarketerTasks, requireBrandPageContext } from '@/lib/dal'
import { formatDateTime } from '@/lib/presentation'

export const instant = true

interface WorkIndexPageProps {
  readonly params: Promise<{ readonly brandId: string }>
}

const WorkIndexContent = async ({ params }: WorkIndexPageProps) => {
  const { brandId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const tasks = await listProductMarketerTasks({ access, limit: 50 })

  return (
    <div className="page-stack">
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">Work ledger</p>
          <h1>Il lavoro lascia ricevute.</h1>
          <p className="lede">
            Phase 0 espone solo il Product Marketer. Stato, output e domande
            rimaste aperte restano nella scheda del singolo task.
          </p>
        </div>
        <div className="counter-mark">
          <strong>{tasks.length}</strong>
          <span>task recenti</span>
        </div>
      </header>

      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Product Marketer</p>
            <h2>Task recenti</h2>
          </div>
          <span>{tasks.length} task</span>
        </div>
        {tasks.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>
              Nessun task richiesto. Il CMO può inviare lavoro specialistico
              solo da un Intent attivo e non ambiguo.
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
                      Product Marketer · {task.status}
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
          status="Caricamento Work."
          title="Il lavoro lascia ricevute."
        />
      }
    >
      <WorkIndexContent {...props} />
    </Suspense>
  )
}
