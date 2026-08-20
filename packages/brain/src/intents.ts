import { randomUUID } from 'node:crypto'

import type { Database } from '@repo/db/client'
import { actions, intents } from '@repo/db/schema/domain'
import {
  evaluatePolicy,
  type PolicyDecision,
  type PolicyOrigin,
} from '@repo/policy'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { operationKey, requestHash } from './canonical'
import type { TrustedCmoTurnAccess, TrustedMemberAccess } from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  requireCurrentBrandMember,
  requireMutationRole,
  requireTrustedCmoTurn,
  requireTrustedHumanActor,
} from './internal'
import { readActionReceipt } from './receipts'

const nonBlankSchema = z.string().trim().min(1)
export const intentStructureListSchema = z.array(z.json()).min(1).max(100)

const intentStructureFields = {
  acceptanceCriteria: intentStructureListSchema.nullable().default(null),
  constraints: intentStructureListSchema.nullable().default(null),
} as const

const validateIntentStructure = (
  structure: {
    readonly acceptanceCriteria: readonly unknown[] | null
    readonly constraints: readonly unknown[] | null
  },
  context: z.RefinementCtx
): void => {
  if (structure.constraints !== null && structure.acceptanceCriteria === null) {
    context.addIssue({
      code: 'custom',
      message: 'Constraints require acceptance criteria',
      path: ['constraints'],
    })
  }
}

export const declareIntentInputSchema = z
  .object({
    ...intentStructureFields,
    requestId: nonBlankSchema.max(500),
    statement: nonBlankSchema.max(4000),
  })
  .strict()
  .superRefine(validateIntentStructure)

export const refineIntentInputSchema = z
  .object({
    ...intentStructureFields,
    expectedRevision: z.number().int().positive(),
    intentId: z.uuid(),
    requestId: nonBlankSchema.max(500),
  })
  .strict()
  .superRefine(validateIntentStructure)

export const adoptIntentInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    intentId: z.uuid(),
    requestId: nonBlankSchema.max(500),
  })
  .strict()

export const abandonIntentInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    intentId: z.uuid(),
    rationale: nonBlankSchema.max(3000).optional(),
    requestId: nonBlankSchema.max(500),
  })
  .strict()

const intentReceiptSnapshotSchema = z
  .object({
    acceptanceCriteria: intentStructureListSchema.nullable(),
    constraints: intentStructureListSchema.nullable(),
    revision: z.number().int().positive(),
    statement: nonBlankSchema.max(4000),
    status: z.enum(['draft', 'active', 'abandoned']),
  })
  .strict()

const intentProducerContextSchema = z.discriminatedUnion('kind', [
  z
    .object({
      authorizingHumanActorId: z.uuid(),
      kind: z.literal('human-direct'),
    })
    .strict(),
  z
    .object({
      authorizingHumanActorId: z.uuid(),
      callId: nonBlankSchema,
      conversationId: z.uuid(),
      kind: z.literal('cmo-interactive'),
      sessionId: nonBlankSchema,
      turnId: nonBlankSchema,
    })
    .strict(),
])

const intentTransitionReceiptFields = {
  actionId: z.uuid(),
  after: intentReceiptSnapshotSchema,
  before: intentReceiptSnapshotSchema,
  intentId: z.uuid(),
  intentRevision: z.number().int().min(2),
  producerContext: intentProducerContextSchema,
} as const

export const declareIntentReceiptSchema = z
  .object({
    actionId: z.uuid(),
    intentId: z.uuid(),
    intentRevision: z.literal(1),
    outcome: z.literal('intent_declared'),
    producerContext: intentProducerContextSchema,
  })
  .strict()

export const proposeIntentReceiptSchema = z
  .object({
    actionId: z.uuid(),
    intentId: z.uuid(),
    intentRevision: z.literal(1),
    outcome: z.literal('intent_proposed'),
    producerContext: intentProducerContextSchema,
  })
  .strict()

export const refineIntentReceiptSchema = z
  .object({
    ...intentTransitionReceiptFields,
    outcome: z.literal('intent_refined'),
  })
  .strict()

export const adoptIntentReceiptSchema = z
  .object({
    ...intentTransitionReceiptFields,
    outcome: z.literal('intent_adopted'),
  })
  .strict()

export const abandonIntentReceiptSchema = z
  .object({
    ...intentTransitionReceiptFields,
    outcome: z.literal('intent_abandoned'),
  })
  .strict()

export type DeclareIntentInput = z.input<typeof declareIntentInputSchema>
export type RefineIntentInput = z.input<typeof refineIntentInputSchema>
export type AdoptIntentInput = z.input<typeof adoptIntentInputSchema>
export type AbandonIntentInput = z.input<typeof abandonIntentInputSchema>
export type DeclareIntentReceipt = z.infer<typeof declareIntentReceiptSchema>
export type ProposeIntentReceipt = z.infer<typeof proposeIntentReceiptSchema>
export type RefineIntentReceipt = z.infer<typeof refineIntentReceiptSchema>
export type AdoptIntentReceipt = z.infer<typeof adoptIntentReceiptSchema>
export type AbandonIntentReceipt = z.infer<typeof abandonIntentReceiptSchema>

type IntentAccess = TrustedMemberAccess | TrustedCmoTurnAccess

interface LockedIntent {
  readonly acceptanceCriteria: unknown
  readonly constraints: unknown
  readonly id: string
  readonly revision: number
  readonly statement: string
  readonly status: 'draft' | 'active' | 'settled' | 'abandoned'
}

const isCmoAccess = (access: IntentAccess): access is TrustedCmoTurnAccess =>
  'cmoActorId' in access

const authorizeIntentMutation = async ({
  access,
  transaction,
}: {
  readonly access: IntentAccess
  readonly transaction: BrainTransaction
}) => {
  const currentMember = await requireCurrentBrandMember(transaction, access)
  await requireTrustedHumanActor(transaction, access)
  if (isCmoAccess(access)) {
    await requireTrustedCmoTurn(transaction, access)
  }
  return currentMember
}

const intentActor = (access: IntentAccess) =>
  isCmoAccess(access)
    ? {
        actorId: access.cmoActorId,
        actorKey: access.cmoActorKey,
        actorKind: 'agent' as const,
        authorizationMode: 'cmo-transduction' as const,
        capability: { capabilityKey: 'cmo:intents', kind: 'granted' as const },
      }
    : {
        actorId: access.humanActorId,
        actorKey: access.humanActorKey,
        actorKind: 'human' as const,
        authorizationMode: 'direct-mutation' as const,
        capability: { kind: 'not-required' as const },
      }

const actionLineage = (access: IntentAccess) =>
  isCmoAccess(access)
    ? {
        callId: access.callId,
        conversationId: access.conversationId,
        sessionId: access.sessionId,
        turnId: access.turnId,
      }
    : { callId: null, conversationId: null, sessionId: null, turnId: null }

const producerContext = (access: IntentAccess) =>
  isCmoAccess(access)
    ? {
        authorizingHumanActorId: access.humanActorId,
        callId: access.callId,
        conversationId: access.conversationId,
        kind: 'cmo-interactive' as const,
        sessionId: access.sessionId,
        turnId: access.turnId,
      }
    : {
        authorizingHumanActorId: access.humanActorId,
        kind: 'human-direct' as const,
      }

const requireAllowed = (policy: PolicyDecision, operation: string): void => {
  if (policy.verdict !== 'allowed') {
    fail('access_denied', `Policy denied ${operation}: ${policy.reason}`)
  }
}

const intentMutationHashContext = (access: IntentAccess) =>
  isCmoAccess(access)
    ? {
        conversationId: access.conversationId,
        sessionId: access.sessionId,
        turnId: access.turnId,
      }
    : { kind: 'human-direct' as const }

const evaluateIntentMutationPolicy = ({
  access,
  origin,
  role,
}: {
  readonly access: IntentAccess
  readonly origin: PolicyOrigin
  readonly role: 'admin' | 'member' | 'owner' | 'viewer'
}) => {
  const actor = intentActor(access)
  return {
    actor,
    policy: evaluatePolicy({
      actor: { actorKey: actor.actorKey, kind: actor.actorKind },
      authorization: {
        humanActorKey: access.humanActorKey,
        kind: 'member',
        membership: { kind: 'current', role },
        mode: actor.authorizationMode,
      },
      capability: actor.capability,
      currentBrandRestrictions: [],
      effect: { phase: 'graph-internal' },
      origin,
    }),
  }
}

const lockBrandIntent = async ({
  brandId,
  intentId,
  transaction,
}: {
  readonly brandId: string
  readonly intentId: string
  readonly transaction: BrainTransaction
}): Promise<LockedIntent | undefined> => {
  const [currentIntent] = await transaction
    .select({
      acceptanceCriteria: intents.acceptanceCriteria,
      constraints: intents.constraints,
      id: intents.id,
      revision: intents.revision,
      statement: intents.statement,
      status: intents.status,
    })
    .from(intents)
    .where(and(eq(intents.brandId, brandId), eq(intents.id, intentId)))
    .for('update')
    .limit(1)
  return currentIntent
}

const structureList = (value: unknown): readonly unknown[] | null =>
  Array.isArray(value) ? value : null

const snapshotStructure = (
  overrideValue: readonly unknown[] | null | undefined,
  current: unknown
): readonly unknown[] | null =>
  overrideValue === undefined ? structureList(current) : overrideValue

const snapshotIntent = (
  intent: LockedIntent,
  override?: {
    readonly acceptanceCriteria?: readonly unknown[] | null
    readonly constraints?: readonly unknown[] | null
    readonly revision?: number
    readonly status?: 'abandoned' | 'active' | 'draft'
  }
) =>
  intentReceiptSnapshotSchema.parse({
    acceptanceCriteria: snapshotStructure(
      override?.acceptanceCriteria,
      intent.acceptanceCriteria
    ),
    constraints: snapshotStructure(override?.constraints, intent.constraints),
    revision: override?.revision ?? intent.revision,
    statement: intent.statement,
    status: override?.status ?? intent.status,
  })

const insertIntentAction = async ({
  access,
  actionId,
  actionType,
  actorId,
  intentId,
  operationKey: receiptOperationKey,
  policy,
  rationale,
  receipt,
  requestHash: semanticHash,
  transaction,
}: {
  readonly access: IntentAccess
  readonly actionId: string
  readonly actionType: string
  readonly actorId: string
  readonly intentId: string
  readonly operationKey: string
  readonly policy: PolicyDecision
  readonly rationale: string
  readonly receipt: unknown
  readonly requestHash: string
  readonly transaction: BrainTransaction
}): Promise<void> => {
  const lineage = actionLineage(access)
  await transaction.insert(actions).values({
    actorId,
    brandId: access.brandId,
    callId: lineage.callId,
    conversationId: lineage.conversationId,
    effectClass: 'graph-internal',
    id: actionId,
    intentId,
    operationKey: receiptOperationKey,
    payload: receipt,
    policySnapshot: policy,
    rationale,
    requestHash: semanticHash,
    sessionId: lineage.sessionId,
    turnId: lineage.turnId,
    type: actionType,
  })
}

const newIntentWorkOrigin = ({
  access,
  intent,
}: {
  readonly access: IntentAccess
  readonly intent: LockedIntent
}): PolicyOrigin => ({
  intent: {
    acceptanceCriteria: Array.isArray(intent.acceptanceCriteria)
      ? intent.acceptanceCriteria
      : null,
    brandId: access.brandId,
    constraints: Array.isArray(intent.constraints) ? intent.constraints : null,
    intentId: intent.id,
    preauthorizations: [],
    revision: intent.revision,
    status: intent.status,
  },
  kind: 'new-intent-work',
})

const declareIntentWithAccess = async ({
  access,
  database,
  input,
}: {
  readonly access: IntentAccess
  readonly database: Database
  readonly input: DeclareIntentInput
}): Promise<DeclareIntentReceipt> => {
  const parsed = declareIntentInputSchema.parse(input)
  const mode = isCmoAccess(access) ? 'cmo' : 'human'
  const receiptOperationKey = operationKey(
    `declare-intent:${mode}`,
    parsed.requestId
  )
  const semanticHash = requestHash({
    acceptanceCriteria: parsed.acceptanceCriteria,
    brandId: access.brandId,
    constraints: parsed.constraints,
    mode,
    organizationId: access.organizationId,
    producerContext: intentMutationHashContext(access),
    statement: parsed.statement,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await authorizeIntentMutation({ access, transaction })
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: declareIntentReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    requireMutationRole(currentMember.role)
    const { actor, policy } = evaluateIntentMutationPolicy({
      access,
      origin: { kind: 'brand-administration' },
      role: currentMember.role,
    })
    requireAllowed(policy, 'Intent declaration')

    const [intent] = await transaction
      .insert(intents)
      .values({
        acceptanceCriteria: parsed.acceptanceCriteria,
        authorActorId: access.humanActorId,
        brandId: access.brandId,
        constraints: parsed.constraints,
        parentIntentId: null,
        revision: 1,
        statement: parsed.statement,
        status: 'active',
      })
      .returning({ id: intents.id })
    if (intent === undefined) {
      return fail('invalid_operation', 'Intent declaration returned no row')
    }

    const actionId = randomUUID()
    const receipt: DeclareIntentReceipt = {
      actionId,
      intentId: intent.id,
      intentRevision: 1,
      outcome: 'intent_declared',
      producerContext: producerContext(access),
    }
    await insertIntentAction({
      access,
      actionId,
      actionType: 'intent_declared',
      actorId: actor.actorId,
      intentId: intent.id,
      operationKey: receiptOperationKey,
      policy,
      rationale:
        mode === 'cmo'
          ? 'Transduce the current human objective into a canonical root Intent'
          : 'Declare a canonical root Intent from an authenticated product mutation',
      receipt,
      requestHash: semanticHash,
      transaction,
    })
    return receipt
  })
}

export const declareIntent = async (input: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: DeclareIntentInput
}): Promise<DeclareIntentReceipt> => await declareIntentWithAccess(input)

export const declareIntentFromCmo = async (input: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
  readonly input: DeclareIntentInput
}): Promise<DeclareIntentReceipt> => await declareIntentWithAccess(input)

const proposeIntentWithAccess = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
  readonly input: DeclareIntentInput
}): Promise<ProposeIntentReceipt> => {
  const parsed = declareIntentInputSchema.parse(input)
  const receiptOperationKey = operationKey(
    'propose-intent:cmo',
    parsed.requestId
  )
  const semanticHash = requestHash({
    acceptanceCriteria: parsed.acceptanceCriteria,
    brandId: access.brandId,
    constraints: parsed.constraints,
    mode: 'cmo',
    organizationId: access.organizationId,
    producerContext: intentMutationHashContext(access),
    statement: parsed.statement,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await authorizeIntentMutation({ access, transaction })
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: proposeIntentReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    requireMutationRole(currentMember.role)
    const { actor, policy } = evaluateIntentMutationPolicy({
      access,
      origin: { kind: 'brand-administration' },
      role: currentMember.role,
    })
    requireAllowed(policy, 'Intent proposal')

    const [intent] = await transaction
      .insert(intents)
      .values({
        acceptanceCriteria: parsed.acceptanceCriteria,
        authorActorId: access.cmoActorId,
        brandId: access.brandId,
        constraints: parsed.constraints,
        parentIntentId: null,
        revision: 1,
        statement: parsed.statement,
        status: 'draft',
      })
      .returning({ id: intents.id })
    if (intent === undefined) {
      return fail('invalid_operation', 'Intent proposal returned no row')
    }

    const actionId = randomUUID()
    const receipt: ProposeIntentReceipt = {
      actionId,
      intentId: intent.id,
      intentRevision: 1,
      outcome: 'intent_proposed',
      producerContext: producerContext(access),
    }
    await insertIntentAction({
      access,
      actionId,
      actionType: 'intent_proposed',
      actorId: actor.actorId,
      intentId: intent.id,
      operationKey: receiptOperationKey,
      policy,
      rationale: 'Propose a draft Intent from the current CMO turn',
      receipt,
      requestHash: semanticHash,
      transaction,
    })
    return receipt
  })
}

export const proposeIntentFromCmo = async (input: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
  readonly input: DeclareIntentInput
}): Promise<ProposeIntentReceipt> => await proposeIntentWithAccess(input)

const refineIntentWithAccess = async ({
  access,
  database,
  input,
}: {
  readonly access: IntentAccess
  readonly database: Database
  readonly input: RefineIntentInput
}): Promise<RefineIntentReceipt> => {
  const parsed = refineIntentInputSchema.parse(input)
  const mode = isCmoAccess(access) ? 'cmo' : 'human'
  const receiptOperationKey = operationKey(
    `refine-intent:${mode}`,
    parsed.requestId
  )
  const semanticHash = requestHash({
    acceptanceCriteria: parsed.acceptanceCriteria,
    brandId: access.brandId,
    constraints: parsed.constraints,
    expectedRevision: parsed.expectedRevision,
    intentId: parsed.intentId,
    mode,
    producerContext: intentMutationHashContext(access),
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await authorizeIntentMutation({ access, transaction })
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: refineIntentReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    requireMutationRole(currentMember.role)
    const currentIntent = await lockBrandIntent({
      brandId: access.brandId,
      intentId: parsed.intentId,
      transaction,
    })
    if (currentIntent === undefined) {
      return fail('intent_not_found', 'Intent does not exist in this brand')
    }
    if (currentIntent.status !== 'active') {
      return fail('intent_not_active', 'Only an active Intent can be refined')
    }
    if (currentIntent.revision !== parsed.expectedRevision) {
      return fail('stale_intent', 'Intent revision changed before refinement')
    }

    const { actor, policy } = evaluateIntentMutationPolicy({
      access,
      origin: newIntentWorkOrigin({ access, intent: currentIntent }),
      role: currentMember.role,
    })
    requireAllowed(policy, 'Intent refinement')

    const nextRevision = currentIntent.revision + 1
    const before = snapshotIntent(currentIntent)
    const after = snapshotIntent(currentIntent, {
      acceptanceCriteria: parsed.acceptanceCriteria,
      constraints: parsed.constraints,
      revision: nextRevision,
    })
    const [updated] = await transaction
      .update(intents)
      .set({
        acceptanceCriteria: parsed.acceptanceCriteria,
        constraints: parsed.constraints,
        revision: nextRevision,
      })
      .where(
        and(
          eq(intents.brandId, access.brandId),
          eq(intents.id, parsed.intentId),
          eq(intents.revision, parsed.expectedRevision),
          eq(intents.status, 'active')
        )
      )
      .returning({ id: intents.id })
    if (updated === undefined) {
      return fail('stale_intent', 'Intent refinement lost its revision race')
    }

    const actionId = randomUUID()
    const receipt: RefineIntentReceipt = {
      actionId,
      after,
      before,
      intentId: parsed.intentId,
      intentRevision: nextRevision,
      outcome: 'intent_refined',
      producerContext: producerContext(access),
    }
    await insertIntentAction({
      access,
      actionId,
      actionType: 'intent_refined',
      actorId: actor.actorId,
      intentId: parsed.intentId,
      operationKey: receiptOperationKey,
      policy,
      rationale:
        mode === 'cmo'
          ? 'Transduce an unambiguous human answer into the active Intent'
          : 'Refine the active Intent from an authenticated product mutation',
      receipt,
      requestHash: semanticHash,
      transaction,
    })
    return receipt
  })
}

export const refineIntent = async (input: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: RefineIntentInput
}): Promise<RefineIntentReceipt> => await refineIntentWithAccess(input)

export const refineIntentFromCmo = async (input: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
  readonly input: RefineIntentInput
}): Promise<RefineIntentReceipt> => await refineIntentWithAccess(input)

export const adoptIntent = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: AdoptIntentInput
}): Promise<AdoptIntentReceipt> => {
  const parsed = adoptIntentInputSchema.parse(input)
  const receiptOperationKey = operationKey(
    'adopt-intent:human',
    parsed.requestId
  )
  const semanticHash = requestHash({
    brandId: access.brandId,
    expectedRevision: parsed.expectedRevision,
    intentId: parsed.intentId,
    organizationId: access.organizationId,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await authorizeIntentMutation({ access, transaction })
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: adoptIntentReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    requireMutationRole(currentMember.role)
    const currentIntent = await lockBrandIntent({
      brandId: access.brandId,
      intentId: parsed.intentId,
      transaction,
    })
    if (currentIntent === undefined) {
      return fail('intent_not_found', 'Intent does not exist in this brand')
    }
    if (currentIntent.status !== 'draft') {
      return fail('intent_not_draft', 'Only a draft Intent can be adopted')
    }
    if (currentIntent.revision !== parsed.expectedRevision) {
      return fail('stale_intent', 'Intent revision changed before adoption')
    }

    const { actor, policy } = evaluateIntentMutationPolicy({
      access,
      origin: { kind: 'brand-administration' },
      role: currentMember.role,
    })
    requireAllowed(policy, 'Intent adoption')

    const nextRevision = currentIntent.revision + 1
    const before = snapshotIntent(currentIntent)
    const after = snapshotIntent(currentIntent, {
      revision: nextRevision,
      status: 'active',
    })
    const [updated] = await transaction
      .update(intents)
      .set({
        revision: nextRevision,
        status: 'active',
      })
      .where(
        and(
          eq(intents.brandId, access.brandId),
          eq(intents.id, parsed.intentId),
          eq(intents.revision, parsed.expectedRevision),
          eq(intents.status, 'draft')
        )
      )
      .returning({ id: intents.id })
    if (updated === undefined) {
      return fail('stale_intent', 'Intent adoption lost its revision race')
    }

    const actionId = randomUUID()
    const receipt: AdoptIntentReceipt = {
      actionId,
      after,
      before,
      intentId: parsed.intentId,
      intentRevision: nextRevision,
      outcome: 'intent_adopted',
      producerContext: producerContext(access),
    }
    await insertIntentAction({
      access,
      actionId,
      actionType: 'intent_adopted',
      actorId: actor.actorId,
      intentId: parsed.intentId,
      operationKey: receiptOperationKey,
      policy,
      rationale:
        'Adopt a proposed Intent from an authenticated product mutation',
      receipt,
      requestHash: semanticHash,
      transaction,
    })
    return receipt
  })
}

export const abandonIntent = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: AbandonIntentInput
}): Promise<AbandonIntentReceipt> => {
  const parsed = abandonIntentInputSchema.parse(input)
  const receiptOperationKey = operationKey(
    'abandon-intent:human',
    parsed.requestId
  )
  const semanticHash = requestHash({
    brandId: access.brandId,
    expectedRevision: parsed.expectedRevision,
    intentId: parsed.intentId,
    organizationId: access.organizationId,
    rationale: parsed.rationale ?? null,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await authorizeIntentMutation({ access, transaction })
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: abandonIntentReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    requireMutationRole(currentMember.role)
    const currentIntent = await lockBrandIntent({
      brandId: access.brandId,
      intentId: parsed.intentId,
      transaction,
    })
    if (currentIntent === undefined) {
      return fail('intent_not_found', 'Intent does not exist in this brand')
    }
    if (currentIntent.status !== 'draft' && currentIntent.status !== 'active') {
      return fail(
        'invalid_operation',
        'Only a draft or active Intent can be abandoned'
      )
    }
    if (currentIntent.revision !== parsed.expectedRevision) {
      return fail('stale_intent', 'Intent revision changed before abandonment')
    }

    const { actor, policy } = evaluateIntentMutationPolicy({
      access,
      origin: { kind: 'brand-administration' },
      role: currentMember.role,
    })
    requireAllowed(policy, 'Intent abandonment')

    const nextRevision = currentIntent.revision + 1
    const before = snapshotIntent(currentIntent)
    const after = snapshotIntent(currentIntent, {
      revision: nextRevision,
      status: 'abandoned',
    })
    const [updated] = await transaction
      .update(intents)
      .set({
        revision: nextRevision,
        status: 'abandoned',
      })
      .where(
        and(
          eq(intents.brandId, access.brandId),
          eq(intents.id, parsed.intentId),
          eq(intents.revision, parsed.expectedRevision),
          inArray(intents.status, ['draft', 'active'])
        )
      )
      .returning({ id: intents.id })
    if (updated === undefined) {
      return fail('stale_intent', 'Intent abandonment lost its revision race')
    }

    const actionId = randomUUID()
    const receipt: AbandonIntentReceipt = {
      actionId,
      after,
      before,
      intentId: parsed.intentId,
      intentRevision: nextRevision,
      outcome: 'intent_abandoned',
      producerContext: producerContext(access),
    }
    await insertIntentAction({
      access,
      actionId,
      actionType: 'intent_abandoned',
      actorId: actor.actorId,
      intentId: parsed.intentId,
      operationKey: receiptOperationKey,
      policy,
      rationale:
        parsed.rationale ??
        'Abandon the current Intent from an authenticated product mutation',
      receipt,
      requestHash: semanticHash,
      transaction,
    })
    return receipt
  })
}
