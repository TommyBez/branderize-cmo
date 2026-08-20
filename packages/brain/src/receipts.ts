import { actions, brands } from '@repo/db/schema/domain'
import { and, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'

import { fail } from './errors'
import type { BrainTransaction } from './internal'

const ACTION_RECEIPT_LOCK_NAMESPACE = 'branderize:action-receipt:v1'
export const COMMITMENT_DISMISSAL_LOCK_NAMESPACE =
  'branderize:commitment-dismissal:v1' as const

const acquireActionReceiptLock = async ({
  lockScope,
  operationKey,
  transaction,
}: {
  readonly lockScope:
    | { readonly brandId: string; readonly kind: 'brand' }
    | { readonly kind: 'organization'; readonly organizationId: string }
    | {
        readonly kind: 'organization-resource'
        readonly organizationId: string
      }
  readonly operationKey: string
  readonly transaction: BrainTransaction
}): Promise<void> => {
  const scopeId =
    lockScope.kind === 'brand' ? lockScope.brandId : lockScope.organizationId
  const lockIdentity = `${ACTION_RECEIPT_LOCK_NAMESPACE}:${lockScope.kind}:${scopeId.length}:${scopeId}:${operationKey}`
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`
  )
}

export const acquireCommitmentDismissalLock = async ({
  brandId,
  kind,
  payloadHash,
  transaction,
}: {
  readonly brandId: string
  readonly kind: string
  readonly payloadHash: string
  readonly transaction: BrainTransaction
}): Promise<void> => {
  const lockIdentity = `${COMMITMENT_DISMISSAL_LOCK_NAMESPACE}:${brandId}:${kind}:${payloadHash}`
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`
  )
}

const parseActionReceipt = <Schema extends z.ZodType>({
  action,
  receiptSchema,
  requestHash,
}: {
  readonly action:
    | { readonly payload: unknown; readonly requestHash: string | null }
    | undefined
  readonly receiptSchema: Schema
  readonly requestHash: string
}): z.output<Schema> | null => {
  if (action === undefined) {
    return null
  }
  if (action.requestHash !== requestHash) {
    fail(
      'operation_conflict',
      'The operation key was already committed with different semantics'
    )
  }

  return receiptSchema.parse(action.payload)
}

export const readActionReceipt = async <Schema extends z.ZodType>({
  brandId,
  operationKey,
  requestHash,
  receiptSchema,
  transaction,
}: {
  readonly brandId: string
  readonly operationKey: string
  readonly receiptSchema: Schema
  readonly requestHash: string
  readonly transaction: BrainTransaction
}): Promise<z.output<Schema> | null> => {
  await acquireActionReceiptLock({
    lockScope: { brandId, kind: 'brand' },
    operationKey,
    transaction,
  })

  const [action] = await transaction
    .select({ payload: actions.payload, requestHash: actions.requestHash })
    .from(actions)
    .where(
      and(eq(actions.brandId, brandId), eq(actions.operationKey, operationKey))
    )
    .limit(1)

  return parseActionReceipt({ action, receiptSchema, requestHash })
}

export const readOrganizationActionReceipt = async <Schema extends z.ZodType>({
  operationKey,
  organizationId,
  resourceKey,
  requestHash,
  receiptSchema,
  transaction,
}: {
  readonly operationKey: string
  readonly organizationId: string
  readonly receiptSchema: Schema
  readonly resourceKey: string
  readonly requestHash: string
  readonly transaction: BrainTransaction
}): Promise<z.output<Schema> | null> => {
  await acquireActionReceiptLock({
    lockScope: { kind: 'organization', organizationId },
    operationKey,
    transaction,
  })
  await acquireActionReceiptLock({
    lockScope: { kind: 'organization-resource', organizationId },
    operationKey: resourceKey,
    transaction,
  })

  const receiptRows = await transaction
    .select({ payload: actions.payload, requestHash: actions.requestHash })
    .from(actions)
    .innerJoin(brands, eq(brands.id, actions.brandId))
    .where(
      and(
        eq(brands.organizationId, organizationId),
        eq(actions.operationKey, operationKey)
      )
    )
    .limit(2)

  if (receiptRows.length > 1) {
    fail(
      'operation_conflict',
      'The organization contains ambiguous receipts for this operation key'
    )
  }

  return parseActionReceipt({
    action: receiptRows[0],
    receiptSchema,
    requestHash,
  })
}
