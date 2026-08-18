import { randomUUID } from 'node:crypto'

import type { Database } from '@repo/db/client'
import { actions, intents } from '@repo/db/schema/domain'
import { evaluatePolicy, type PolicyDecision } from '@repo/policy'
import { and, eq } from 'drizzle-orm'
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

const intentReceiptSnapshotSchema = z
  .object({
    acceptanceCriteria: intentStructureListSchema.nullable(),
    constraints: intentStructureListSchema.nullable(),
    revision: z.number().int().positive(),
    statement: nonBlankSchema.max(4000),
    status: z.enum(['draft', 'active']),
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

export const declareIntentReceiptSchema = z
  .object({
    actionId: z.uuid(),
    intentId: z.uuid(),
    intentRevision: z.literal(1),
    outcome: z.literal('intent_declared'),
    producerContext: intentProducerContextSchema,
  })
  .strict()

export const refineIntentReceiptSchema = z
  .object({
    actionId: z.uuid(),
    after: intentReceiptSnapshotSchema,
    before: intentReceiptSnapshotSchema,
    intentId: z.uuid(),
    intentRevision: z.number().int().min(2),
    outcome: z.literal('intent_refined'),
    producerContext: intentProducerContextSchema,
  })
  .strict()

export type DeclareIntentInput = z.input<typeof declareIntentInputSchema>
export type RefineIntentInput = z.input<typeof refineIntentInputSchema>
export type DeclareIntentReceipt = z.infer<typeof declareIntentReceiptSchema>
export type RefineIntentReceipt = z.infer<typeof refineIntentReceiptSchema>

type IntentAccess = TrustedMemberAccess | TrustedCmoTurnAccess

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
  const lineage = actionLineage(access)
  const semanticHash = requestHash({
    acceptanceCriteria: parsed.acceptanceCriteria,
    brandId: access.brandId,
    constraints: parsed.constraints,
    mode,
    organizationId: access.organizationId,
    producerContext: isCmoAccess(access)
      ? {
          conversationId: access.conversationId,
          sessionId: access.sessionId,
          turnId: access.turnId,
        }
      : { kind: 'human-direct' },
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
    const actor = intentActor(access)
    const policy = evaluatePolicy({
      actor: { actorKey: actor.actorKey, kind: actor.actorKind },
      authorization: {
        humanActorKey: access.humanActorKey,
        kind: 'member',
        membership: { kind: 'current', role: currentMember.role },
        mode: actor.authorizationMode,
      },
      capability: actor.capability,
      currentBrandRestrictions: [],
      effect: { phase: 'graph-internal' },
      origin: { kind: 'brand-administration' },
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
    await transaction.insert(actions).values({
      actorId: actor.actorId,
      brandId: access.brandId,
      callId: lineage.callId,
      conversationId: lineage.conversationId,
      effectClass: 'graph-internal',
      id: actionId,
      intentId: intent.id,
      operationKey: receiptOperationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale:
        mode === 'cmo'
          ? 'Transduce the current human objective into a canonical root Intent'
          : 'Declare a canonical root Intent from an authenticated product mutation',
      requestHash: semanticHash,
      sessionId: lineage.sessionId,
      turnId: lineage.turnId,
      type: 'intent_declared',
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
  const lineage = actionLineage(access)
  const semanticHash = requestHash({
    acceptanceCriteria: parsed.acceptanceCriteria,
    brandId: access.brandId,
    constraints: parsed.constraints,
    expectedRevision: parsed.expectedRevision,
    intentId: parsed.intentId,
    mode,
    producerContext: isCmoAccess(access)
      ? {
          conversationId: access.conversationId,
          sessionId: access.sessionId,
          turnId: access.turnId,
        }
      : { kind: 'human-direct' },
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
      .where(
        and(
          eq(intents.brandId, access.brandId),
          eq(intents.id, parsed.intentId)
        )
      )
      .for('update')
      .limit(1)
    if (currentIntent === undefined) {
      return fail('intent_not_found', 'Intent does not exist in this brand')
    }
    if (currentIntent.status !== 'active') {
      return fail('intent_not_active', 'Only an active Intent can be refined')
    }
    if (currentIntent.revision !== parsed.expectedRevision) {
      return fail('stale_intent', 'Intent revision changed before refinement')
    }

    const actor = intentActor(access)
    const policy = evaluatePolicy({
      actor: { actorKey: actor.actorKey, kind: actor.actorKind },
      authorization: {
        humanActorKey: access.humanActorKey,
        kind: 'member',
        membership: { kind: 'current', role: currentMember.role },
        mode: actor.authorizationMode,
      },
      capability: actor.capability,
      currentBrandRestrictions: [],
      effect: { phase: 'graph-internal' },
      origin: {
        intent: {
          acceptanceCriteria: Array.isArray(currentIntent.acceptanceCriteria)
            ? currentIntent.acceptanceCriteria
            : null,
          brandId: access.brandId,
          constraints: Array.isArray(currentIntent.constraints)
            ? currentIntent.constraints
            : null,
          intentId: currentIntent.id,
          preauthorizations: [],
          revision: currentIntent.revision,
          status: currentIntent.status,
        },
        kind: 'new-intent-work',
      },
    })
    requireAllowed(policy, 'Intent refinement')

    const nextRevision = currentIntent.revision + 1
    const before = intentReceiptSnapshotSchema.parse({
      acceptanceCriteria: Array.isArray(currentIntent.acceptanceCriteria)
        ? currentIntent.acceptanceCriteria
        : null,
      constraints: Array.isArray(currentIntent.constraints)
        ? currentIntent.constraints
        : null,
      revision: currentIntent.revision,
      statement: currentIntent.statement,
      status: currentIntent.status,
    })
    const after = intentReceiptSnapshotSchema.parse({
      acceptanceCriteria: parsed.acceptanceCriteria,
      constraints: parsed.constraints,
      revision: nextRevision,
      statement: currentIntent.statement,
      status: currentIntent.status,
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
    await transaction.insert(actions).values({
      actorId: actor.actorId,
      brandId: access.brandId,
      callId: lineage.callId,
      conversationId: lineage.conversationId,
      effectClass: 'graph-internal',
      id: actionId,
      intentId: parsed.intentId,
      operationKey: receiptOperationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale:
        mode === 'cmo'
          ? 'Transduce an unambiguous human answer into the active Intent'
          : 'Refine the active Intent from an authenticated product mutation',
      requestHash: semanticHash,
      sessionId: lineage.sessionId,
      turnId: lineage.turnId,
      type: 'intent_refined',
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
