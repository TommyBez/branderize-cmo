import type {
  AgentKey,
  RegisteredTaskKindKey,
  TaskPayloadOf,
} from '@repo/agents'
import type { TaskIntentSnapshot } from '@repo/agents/task-snapshot'
import type { Database } from '@repo/db/client'
import { objects } from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'

import type { TrustedTaskExecution } from './context'
import { fail } from './errors'
import { type BrainTransaction, requireTrustedAgentActor } from './internal'
import { BRAND_CONTEXT_SINGLETON_KEY } from './object-contracts'

export interface RegisteredTaskClaimAdapterInput<
  TKind extends RegisteredTaskKindKey = RegisteredTaskKindKey,
> {
  readonly brandId: string
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: TKind
  readonly payload: TaskPayloadOf<TKind>
  readonly taskId: string
  readonly transaction: BrainTransaction
  readonly workerKey: AgentKey
}

export type RegisteredTaskClaimAdapter<
  TKind extends RegisteredTaskKindKey = RegisteredTaskKindKey,
> = (input: RegisteredTaskClaimAdapterInput<TKind>) => Promise<unknown>

export const loadActiveBrandContext = async ({
  brandId,
  transaction,
}: {
  readonly brandId: string
  readonly transaction: BrainTransaction
}) => {
  const [brandContext] = await transaction
    .select({ content: objects.content, id: objects.id })
    .from(objects)
    .where(
      and(
        eq(objects.brandId, brandId),
        eq(objects.singletonKey, BRAND_CONTEXT_SINGLETON_KEY),
        eq(objects.status, 'active')
      )
    )
    .for('share')
    .limit(1)
  if (brandContext === undefined) {
    return fail('invalid_task', 'Task has no Brand Context')
  }
  return {
    brandContextContent: brandContext.content,
    brandContextObjectId: brandContext.id,
  }
}

export const readBrandContextProjection = async ({
  database,
  execution,
}: {
  readonly database: Database
  readonly execution: TrustedTaskExecution
}) =>
  await database.transaction(async (transaction) => {
    await requireTrustedAgentActor(transaction, {
      actorId: execution.agentActorId,
      actorKey: execution.agentActorKey,
    })
    return await loadActiveBrandContext({
      brandId: execution.brandId,
      transaction,
    })
  })

const loadBrandContextClaim = async ({
  brandId,
  transaction,
}: RegisteredTaskClaimAdapterInput) =>
  await loadActiveBrandContext({ brandId, transaction })

export const claimContextAdapters: {
  readonly [K in RegisteredTaskKindKey]: RegisteredTaskClaimAdapter
} = {
  'content.brief.v1': loadBrandContextClaim,
  'distribution.channel-plan.v1': loadBrandContextClaim,
  'product-marketer.brand-context.v1': loadBrandContextClaim,
  'seo-discovery.opportunity.v1': loadBrandContextClaim,
}
