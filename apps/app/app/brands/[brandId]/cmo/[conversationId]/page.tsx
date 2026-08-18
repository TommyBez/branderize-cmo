import Link from 'next/link'
import { Suspense } from 'react'
import { CmoConsole } from '@/components/cmo-console'
import { CmoReadOnly } from '@/components/cmo-read-only'
import { NavigationPending } from '@/components/navigation-pending'
import {
  authorizeCmoSourceTaskClaim,
  loadCmoConsoleState,
  openOwnedCmoConversation,
} from '@/lib/cmo'
import { requireBrandPageContext } from '@/lib/dal'

export const instant = true

interface CmoConversationPageProps {
  readonly params: Promise<{
    readonly brandId: string
    readonly conversationId: string
  }>
  readonly searchParams: Promise<{
    readonly sourceTaskId?: string | string[]
  }>
}

const CmoConversationContent = async ({
  params,
  searchParams,
}: CmoConversationPageProps) => {
  const { brandId, conversationId } = await params
  const { access } = await requireBrandPageContext(brandId)
  const conversation = await openOwnedCmoConversation({
    access,
    conversationId,
  })
  const query = await searchParams
  const requestedSourceTaskId =
    typeof query.sourceTaskId === 'string' ? query.sourceTaskId : null
  const sourceTaskId =
    requestedSourceTaskId === null
      ? null
      : await authorizeCmoSourceTaskClaim({
          access,
          sourceTaskId: requestedSourceTaskId,
        })
  const consoleState = await loadCmoConsoleState({ access, conversation })

  return (
    <div className="page-stack page-stack--cmo">
      <header className="cmo-header">
        <div>
          <Link className="back-link" href={`/brands/${brandId}/cmo`}>
            ← Conversazioni
          </Link>
          <p className="eyebrow">Private CMO</p>
          <h1>{conversation.title ?? 'Conversazione senza titolo'}</h1>
        </div>
        <span className="privacy-mark">Owner-private</span>
      </header>

      {consoleState.kind === 'available' ? (
        <CmoConsole
          brandId={brandId}
          conversationId={conversation.id}
          initialEvents={consoleState.initialEvents}
          initialSession={consoleState.initialSession}
          initialSourceTaskId={sourceTaskId}
          readOnly={access.role === 'viewer'}
          recoveryRequired={consoleState.recoveryRequired}
        />
      ) : (
        <CmoReadOnly messages={consoleState.messages} />
      )}
    </div>
  )
}

export default function CmoConversationPage(props: CmoConversationPageProps) {
  return (
    <Suspense
      fallback={
        <NavigationPending
          eyebrow="Private CMO"
          status="Caricamento della conversazione CMO."
          title="Apro la conversazione privata."
          variant="detail"
        />
      }
    >
      <CmoConversationContent {...props} />
    </Suspense>
  )
}
