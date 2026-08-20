import { randomUUID } from 'node:crypto'
import { readBrandConnectionCapabilities } from '@repo/brain/connections'
import { db } from '@repo/db'
import { Suspense } from 'react'
import {
  ConnectConnectionForm,
  DisconnectConnectionForm,
} from '@/components/connection-slot-form'
import { NavigationPending } from '@/components/navigation-pending'
import { requireBrandPageContext } from '@/lib/dal'
import { canMutateRole, connectionSlotLabel } from '@/lib/presentation'

export const instant = true

interface ConnectionsPageProps {
  readonly params: Promise<{ readonly brandId: string }>
}

const ConnectionSlot = ({
  brandId,
  canMutate,
  capability,
  slot,
}: {
  readonly brandId: string
  readonly canMutate: boolean
  readonly capability: Awaited<
    ReturnType<typeof readBrandConnectionCapabilities>
  >['notion']
  readonly slot: 'notion' | 'typefully'
}) => {
  const granted = capability.kind === 'granted'

  return (
    <article className="paper-panel">
      <p className="eyebrow">{granted ? 'Granted' : 'Missing'}</p>
      <h2>{connectionSlotLabel(slot)}</h2>
      {granted ? (
        <>
          <p>{capability.accountLabel}</p>
          <p className="muted">
            Scopes:{' '}
            {capability.scopes.length === 0
              ? 'none granted'
              : capability.scopes.join(', ')}
          </p>
          {canMutate ? (
            <DisconnectConnectionForm
              brandId={brandId}
              providerSlot={slot}
              requestId={randomUUID()}
            />
          ) : null}
        </>
      ) : (
        <>
          <p>
            This brand has no active {connectionSlotLabel(slot)} connection.
          </p>
          <p className="muted">
            The granted gap is empty. Secrets stay outside the graph.
          </p>
          {canMutate ? (
            <ConnectConnectionForm
              brandId={brandId}
              providerSlot={slot}
              requestId={randomUUID()}
            />
          ) : null}
        </>
      )}
    </article>
  )
}

const ConnectionsContent = async ({ params }: ConnectionsPageProps) => {
  const { brandId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const snapshot = await readBrandConnectionCapabilities({
    access,
    database: db,
  })
  const canMutate = canMutateRole(access.role)

  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="eyebrow">Connections</p>
        <h1>Providers stay outside the graph.</h1>
        <p className="lede">
          Notion and Typefully appear as account labels and scopes. Tokens never
          render.
        </p>
      </header>

      <div className="two-column-detail">
        <ConnectionSlot
          brandId={brandId}
          canMutate={canMutate}
          capability={snapshot.notion}
          slot="notion"
        />
        <ConnectionSlot
          brandId={brandId}
          canMutate={canMutate}
          capability={snapshot.typefully}
          slot="typefully"
        />
      </div>
    </div>
  )
}

export default function ConnectionsPage(props: ConnectionsPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Connections"
          status="Loading connections."
          title="Providers stay outside the graph."
        />
      }
    >
      <ConnectionsContent {...props} />
    </Suspense>
  )
}
