import type {
  AgentKey,
  RegisteredTaskKindKey,
  TaskPayloadOf,
} from '@repo/agents'
import type { TaskIntentSnapshot } from '@repo/agents/task-snapshot'
import { objects } from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'

import { fail } from './errors'
import type { BrainTransaction } from './internal'
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

export type RegisteredTaskClaimAdapter<TKind extends RegisteredTaskKindKey> = (
  input: RegisteredTaskClaimAdapterInput<TKind>
) => Promise<unknown>

const loadBrandContextClaim = async ({
  brandId,
  transaction,
}: RegisteredTaskClaimAdapterInput<'product-marketer.brand-context.v1'>) => {
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
    return fail('invalid_task', 'Product Marketer task has no Brand Context')
  }
  return {
    brandContextContent: brandContext.content,
    brandContextObjectId: brandContext.id,
  }
}

export const claimContextAdapters: {
  readonly [K in RegisteredTaskKindKey]: RegisteredTaskClaimAdapter<K>
} = {
  'product-marketer.brand-context.v1': loadBrandContextClaim,
}
