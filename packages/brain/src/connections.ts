import { randomUUID } from 'node:crypto'

import {
  type ActiveBrandConnection,
  capabilityKeyForSlot,
  PROVIDER_SLOTS,
  type ProviderSlot,
  providerSlotSchema,
  type ReadActiveBrandConnection,
} from '@repo/connections/connect'
import type { Database } from '@repo/db/client'
import { actions, brandConnections } from '@repo/db/schema/domain'
import { evaluatePolicy, type PolicyDecision } from '@repo/policy'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { operationKey, requestHash } from './canonical'
import type { TrustedMemberAccess } from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  requireCurrentBrandMember,
  requireMutationRole,
  requireTrustedHumanActor,
} from './internal'
import { readActionReceipt } from './receipts'

const UNIQUE_VIOLATION = '23505'
const nonBlankSchema = z.string().trim().min(1)
const scopesSchema = z.array(nonBlankSchema.max(128)).max(64)

export const connectBrandConnectionInputSchema = z
  .object({
    accountLabel: nonBlankSchema.max(240),
    connectorUid: nonBlankSchema.max(512),
    installationId: nonBlankSchema.max(512).nullable().default(null),
    providerSlot: providerSlotSchema,
    requestId: nonBlankSchema.max(500),
    scopes: scopesSchema.default([]),
  })
  .strict()

export const disconnectBrandConnectionInputSchema = z
  .object({
    providerSlot: providerSlotSchema,
    requestId: nonBlankSchema.max(500),
  })
  .strict()

const connectionReferenceSchema = z
  .object({
    accountLabel: nonBlankSchema.max(240),
    connectionId: z.uuid(),
    connectorUid: nonBlankSchema.max(512),
    installationId: nonBlankSchema.max(512).nullable(),
    providerSlot: providerSlotSchema,
    scopes: scopesSchema,
  })
  .strict()

export const connectBrandConnectionReceiptSchema = connectionReferenceSchema
  .extend({
    actionId: z.uuid(),
    outcome: z.literal('connection_connected'),
  })
  .strict()

export const disconnectBrandConnectionReceiptSchema = connectionReferenceSchema
  .extend({
    actionId: z.uuid(),
    outcome: z.literal('connection_disconnected'),
  })
  .strict()

const grantedCapabilitySchema = connectionReferenceSchema
  .extend({
    capabilityKey: z.enum(['connection:notion', 'connection:typefully']),
    kind: z.literal('granted'),
  })
  .strict()

const missingCapabilitySchema = z
  .object({
    capabilityKey: z.enum(['connection:notion', 'connection:typefully']),
    kind: z.literal('missing'),
  })
  .strict()

export const brandConnectionCapabilitySchema = z.discriminatedUnion('kind', [
  grantedCapabilitySchema,
  missingCapabilitySchema,
])

export const brandConnectionCapabilitySnapshotSchema = z
  .object({
    notion: brandConnectionCapabilitySchema,
    typefully: brandConnectionCapabilitySchema,
  })
  .strict()

export type ConnectBrandConnectionInput = z.input<
  typeof connectBrandConnectionInputSchema
>
export type DisconnectBrandConnectionInput = z.input<
  typeof disconnectBrandConnectionInputSchema
>
export type ConnectBrandConnectionReceipt = z.infer<
  typeof connectBrandConnectionReceiptSchema
>
export type DisconnectBrandConnectionReceipt = z.infer<
  typeof disconnectBrandConnectionReceiptSchema
>
export type BrandConnectionCapability = z.infer<
  typeof brandConnectionCapabilitySchema
>
export type BrandConnectionCapabilitySnapshot = z.infer<
  typeof brandConnectionCapabilitySnapshotSchema
>

interface LockedBrandConnection {
  readonly accountLabel: string
  readonly connectorUid: string
  readonly id: string
  readonly installationId: string | null
  readonly providerSlot: ProviderSlot
  readonly scopes: unknown
  readonly status: 'active' | 'inactive'
}

const parseScopes = (value: unknown): string[] => [
  ...scopesSchema.parse(Array.isArray(value) ? value : []),
]

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === UNIQUE_VIOLATION

const requireAllowed = (policy: PolicyDecision, operation: string): void => {
  if (policy.verdict !== 'allowed') {
    fail('access_denied', `Policy denied ${operation}: ${policy.reason}`)
  }
}

const evaluateConnectionMutationPolicy = ({
  access,
  role,
}: {
  readonly access: TrustedMemberAccess
  readonly role: 'admin' | 'member' | 'owner' | 'viewer'
}): PolicyDecision =>
  evaluatePolicy({
    actor: { actorKey: access.humanActorKey, kind: 'human' },
    authorization: {
      humanActorKey: access.humanActorKey,
      kind: 'member',
      membership: { kind: 'current', role },
      mode: 'direct-mutation',
    },
    capability: { kind: 'not-required' },
    currentBrandRestrictions: [],
    effect: { phase: 'graph-internal' },
    origin: { kind: 'brand-administration' },
  })

const lockActiveBrandConnection = async ({
  brandId,
  providerSlot,
  transaction,
}: {
  readonly brandId: string
  readonly providerSlot: ProviderSlot
  readonly transaction: BrainTransaction
}): Promise<LockedBrandConnection | undefined> => {
  const [current] = await transaction
    .select({
      accountLabel: brandConnections.accountLabel,
      connectorUid: brandConnections.connectorUid,
      id: brandConnections.id,
      installationId: brandConnections.installationId,
      providerSlot: brandConnections.providerSlot,
      scopes: brandConnections.scopes,
      status: brandConnections.status,
    })
    .from(brandConnections)
    .where(
      and(
        eq(brandConnections.brandId, brandId),
        eq(brandConnections.providerSlot, providerSlot),
        eq(brandConnections.status, 'active')
      )
    )
    .for('update')
    .limit(1)
  return current
}

const toReference = (
  connection: LockedBrandConnection
): z.infer<typeof connectionReferenceSchema> =>
  connectionReferenceSchema.parse({
    accountLabel: connection.accountLabel,
    connectionId: connection.id,
    connectorUid: connection.connectorUid,
    installationId: connection.installationId,
    providerSlot: connection.providerSlot,
    scopes: parseScopes(connection.scopes),
  })

const insertConnectionAction = async ({
  access,
  actionId,
  actionType,
  policy,
  rationale,
  receipt,
  receiptOperationKey,
  semanticHash,
  transaction,
}: {
  readonly access: TrustedMemberAccess
  readonly actionId: string
  readonly actionType: 'connection_connected' | 'connection_disconnected'
  readonly policy: PolicyDecision
  readonly rationale: string
  readonly receipt: unknown
  readonly receiptOperationKey: string
  readonly semanticHash: string
  readonly transaction: BrainTransaction
}): Promise<void> => {
  await transaction.insert(actions).values({
    actorId: access.humanActorId,
    brandId: access.brandId,
    effectClass: 'graph-internal',
    id: actionId,
    operationKey: receiptOperationKey,
    payload: receipt,
    policySnapshot: policy,
    rationale,
    requestHash: semanticHash,
    type: actionType,
  })
}

export const lookupActiveBrandConnection = async ({
  brandId,
  database,
  providerSlot,
}: {
  readonly brandId: string
  readonly database: Database
  readonly providerSlot: ProviderSlot
}): Promise<ActiveBrandConnection | null> => {
  const parsedSlot = providerSlotSchema.parse(providerSlot)
  const [row] = await database
    .select({
      accountLabel: brandConnections.accountLabel,
      brandId: brandConnections.brandId,
      connectorUid: brandConnections.connectorUid,
      installationId: brandConnections.installationId,
      providerSlot: brandConnections.providerSlot,
      scopes: brandConnections.scopes,
    })
    .from(brandConnections)
    .where(
      and(
        eq(brandConnections.brandId, brandId),
        eq(brandConnections.providerSlot, parsedSlot),
        eq(brandConnections.status, 'active')
      )
    )
    .limit(1)

  if (row === undefined) {
    return null
  }

  return {
    accountLabel: row.accountLabel,
    brandId: row.brandId,
    connectorUid: row.connectorUid,
    installationId: row.installationId,
    providerSlot: row.providerSlot,
    scopes: parseScopes(row.scopes),
  }
}

export const createActiveBrandConnectionReader =
  (database: Database): ReadActiveBrandConnection =>
  async (input) =>
    await lookupActiveBrandConnection({ database, ...input })

const missingCapability = (
  providerSlot: ProviderSlot
): BrandConnectionCapability => ({
  capabilityKey: capabilityKeyForSlot(providerSlot),
  kind: 'missing',
})

const grantedCapability = (
  connection: ActiveBrandConnection & { readonly connectionId: string }
): BrandConnectionCapability =>
  grantedCapabilitySchema.parse({
    accountLabel: connection.accountLabel,
    capabilityKey: capabilityKeyForSlot(connection.providerSlot),
    connectionId: connection.connectionId,
    connectorUid: connection.connectorUid,
    installationId: connection.installationId,
    kind: 'granted',
    providerSlot: connection.providerSlot,
    scopes: connection.scopes,
  })

export const readBrandConnectionCapabilities = async ({
  access,
  database,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
}): Promise<BrandConnectionCapabilitySnapshot> => {
  await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    await requireTrustedHumanActor(transaction, access)
  })

  const rows = await database
    .select({
      accountLabel: brandConnections.accountLabel,
      brandId: brandConnections.brandId,
      connectorUid: brandConnections.connectorUid,
      id: brandConnections.id,
      installationId: brandConnections.installationId,
      providerSlot: brandConnections.providerSlot,
      scopes: brandConnections.scopes,
    })
    .from(brandConnections)
    .where(
      and(
        eq(brandConnections.brandId, access.brandId),
        eq(brandConnections.status, 'active')
      )
    )

  const snapshot: Record<ProviderSlot, BrandConnectionCapability> = {
    notion: missingCapability('notion'),
    typefully: missingCapability('typefully'),
  }

  for (const row of rows) {
    snapshot[row.providerSlot] = grantedCapability({
      accountLabel: row.accountLabel,
      brandId: row.brandId,
      connectionId: row.id,
      connectorUid: row.connectorUid,
      installationId: row.installationId,
      providerSlot: row.providerSlot,
      scopes: parseScopes(row.scopes),
    })
  }

  return brandConnectionCapabilitySnapshotSchema.parse(snapshot)
}

export const connectBrandConnection = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: ConnectBrandConnectionInput
}): Promise<ConnectBrandConnectionReceipt> => {
  const parsed = connectBrandConnectionInputSchema.parse(input)
  const receiptOperationKey = operationKey(
    'connect-connection:human',
    parsed.requestId
  )
  const semanticHash = requestHash({
    accountLabel: parsed.accountLabel,
    brandId: access.brandId,
    connectorUid: parsed.connectorUid,
    installationId: parsed.installationId,
    organizationId: access.organizationId,
    providerSlot: parsed.providerSlot,
    scopes: parsed.scopes,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    await requireTrustedHumanActor(transaction, access)
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: connectBrandConnectionReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    requireMutationRole(currentMember.role)
    const policy = evaluateConnectionMutationPolicy({
      access,
      role: currentMember.role,
    })
    requireAllowed(policy, 'brand connection')

    const existing = await lockActiveBrandConnection({
      brandId: access.brandId,
      providerSlot: parsed.providerSlot,
      transaction,
    })
    if (existing !== undefined) {
      return fail(
        'operation_conflict',
        'This brand already has an active connection for that slot'
      )
    }

    const connectionId = randomUUID()
    try {
      await transaction.insert(brandConnections).values({
        accountLabel: parsed.accountLabel,
        brandId: access.brandId,
        connectorUid: parsed.connectorUid,
        id: connectionId,
        installationId: parsed.installationId,
        providerSlot: parsed.providerSlot,
        scopes: parsed.scopes,
        status: 'active',
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return fail(
          'operation_conflict',
          'This brand already has an active connection for that slot'
        )
      }
      throw error
    }

    const actionId = randomUUID()
    const receipt: ConnectBrandConnectionReceipt =
      connectBrandConnectionReceiptSchema.parse({
        accountLabel: parsed.accountLabel,
        actionId,
        connectionId,
        connectorUid: parsed.connectorUid,
        installationId: parsed.installationId,
        outcome: 'connection_connected',
        providerSlot: parsed.providerSlot,
        scopes: parsed.scopes,
      })
    await insertConnectionAction({
      access,
      actionId,
      actionType: 'connection_connected',
      policy,
      rationale:
        'Record a brand-owned provider connection reference from an authenticated product mutation',
      receipt,
      receiptOperationKey,
      semanticHash,
      transaction,
    })
    return receipt
  })
}

export const disconnectBrandConnection = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: DisconnectBrandConnectionInput
}): Promise<DisconnectBrandConnectionReceipt> => {
  const parsed = disconnectBrandConnectionInputSchema.parse(input)
  const receiptOperationKey = operationKey(
    'disconnect-connection:human',
    parsed.requestId
  )
  const semanticHash = requestHash({
    brandId: access.brandId,
    organizationId: access.organizationId,
    providerSlot: parsed.providerSlot,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    await requireTrustedHumanActor(transaction, access)
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: disconnectBrandConnectionReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    requireMutationRole(currentMember.role)
    const policy = evaluateConnectionMutationPolicy({
      access,
      role: currentMember.role,
    })
    requireAllowed(policy, 'brand disconnection')

    const current = await lockActiveBrandConnection({
      brandId: access.brandId,
      providerSlot: parsed.providerSlot,
      transaction,
    })
    if (current === undefined) {
      return fail(
        'invalid_operation',
        'This brand has no active connection for that slot'
      )
    }

    const [updated] = await transaction
      .update(brandConnections)
      .set({ status: 'inactive' })
      .where(
        and(
          eq(brandConnections.brandId, access.brandId),
          eq(brandConnections.id, current.id),
          eq(brandConnections.status, 'active')
        )
      )
      .returning({ id: brandConnections.id })
    if (updated === undefined) {
      return fail(
        'invalid_operation',
        'The active connection changed before disconnection'
      )
    }

    const actionId = randomUUID()
    const receipt: DisconnectBrandConnectionReceipt =
      disconnectBrandConnectionReceiptSchema.parse({
        ...toReference(current),
        actionId,
        outcome: 'connection_disconnected',
      })
    await insertConnectionAction({
      access,
      actionId,
      actionType: 'connection_disconnected',
      policy,
      rationale:
        'Mark a brand-owned provider connection inactive from an authenticated product mutation',
      receipt,
      receiptOperationKey,
      semanticHash,
      transaction,
    })
    return receipt
  })
}

export const CONNECTION_PROVIDER_SLOTS = PROVIDER_SLOTS
