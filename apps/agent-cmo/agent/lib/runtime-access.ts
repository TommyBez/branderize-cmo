import { productMarketerCompletionSchema } from '@repo/agents/tasks'
import { operationKey, requestHash } from '@repo/brain/canonical'
import {
  memberRoleSchema,
  type TrustedCmoTurnAccess,
  type TrustedMemberAccess,
} from '@repo/brain/context'
import type { Database } from '@repo/db/client'
import { member } from '@repo/db/schema/auth'
import {
  actions,
  actors,
  brands,
  cmoConversations,
  intents,
  tasks,
} from '@repo/db/schema/domain'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { SessionAuthContext } from 'eve/context'
import type { HookContext } from 'eve/hooks'
import type { ToolContext } from 'eve/tools'
import { z } from 'zod'

const CMO_AUTHENTICATOR = 'cmo-bridge'
const CMO_ACTOR_KEY = 'agent:cmo'
const PRODUCT_MARKETER_TASK_KIND = 'product-marketer.brand-context.v1'
const CMO_INTENT_ACTION_TYPES = ['intent_declared', 'intent_refined'] as const
const uuidSchema = z.uuid()

const cmoIntentReceiptSchema = z
  .object({
    intentId: z.uuid(),
    producerContext: z.object({
      conversationId: z.uuid(),
      kind: z.literal('cmo-interactive'),
      sessionId: z.string().trim().min(1),
      turnId: z.string().trim().min(1),
    }),
  })
  .passthrough()

const cmoRefineIntentReceiptSchema = cmoIntentReceiptSchema.extend({
  before: z.object({ revision: z.number().int().positive() }).passthrough(),
  outcome: z.literal('intent_refined'),
})

export interface CmoSessionIdentity {
  readonly brandId: string
  readonly conversationId: string
  readonly userId: string
}

export interface TrustedCmoSessionMemberAccess extends TrustedMemberAccess {
  readonly conversationId: string
}

export interface ActiveIntentTarget {
  readonly id: string
  readonly revision: number
}

interface CmoIntentActionCandidate {
  readonly actorKey: string
  readonly actorType: string
  readonly intentId: string | null
  readonly payload: unknown
  readonly sessionId: string | null
}

type CmoIntentProvenanceScope =
  | {
      readonly conversationId: string
      readonly kind: 'conversation'
    }
  | {
      readonly conversationId: string
      readonly kind: 'current-turn'
      readonly sessionId: string
      readonly turnId: string
    }

const readScalarAttribute = (auth: SessionAuthContext, key: string): string => {
  const value = auth.attributes[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Trusted CMO attribute ${key} is missing`)
  }
  return value
}

const identityFromAuth = (auth: SessionAuthContext): CmoSessionIdentity => {
  const brandId = readScalarAttribute(auth, 'brand_id')
  const conversationId = readScalarAttribute(auth, 'conversation_id')
  if (
    auth.authenticator !== CMO_AUTHENTICATOR ||
    auth.principalType !== 'user' ||
    auth.principalId.length === 0 ||
    (auth.subject !== undefined && auth.subject !== auth.principalId)
  ) {
    throw new Error('CMO session authority is invalid')
  }
  return { brandId, conversationId, userId: auth.principalId }
}

const identitiesMatch = (
  left: CmoSessionIdentity,
  right: CmoSessionIdentity
): boolean =>
  left.brandId === right.brandId &&
  left.conversationId === right.conversationId &&
  left.userId === right.userId

export const readCmoSessionIdentity = (
  context: Pick<HookContext, 'session'> | Pick<ToolContext, 'session'>
): CmoSessionIdentity => {
  const { current, initiator } = context.session.auth
  if (initiator === null) {
    throw new Error('CMO initiating authentication is missing')
  }
  if (current === null) {
    throw new Error('CMO current authentication is missing')
  }
  const initiatingIdentity = identityFromAuth(initiator)
  const currentIdentity = identityFromAuth(current)
  if (!identitiesMatch(currentIdentity, initiatingIdentity)) {
    throw new Error('CMO session authority changed')
  }
  return currentIdentity
}

export const readCurrentCmoSourceTaskId = (
  context: Pick<ToolContext, 'session'>
): string => {
  if (context.session.parent !== undefined) {
    throw new Error('CMO canonical tools are root-only')
  }
  readCmoSessionIdentity(context)
  const { current } = context.session.auth
  if (current === null) {
    throw new Error('CMO current authentication is missing')
  }
  const sourceTaskId = current.attributes.source_task_id
  const parsed = uuidSchema.safeParse(sourceTaskId)
  if (!parsed.success) {
    throw new Error('The current CMO turn has no trusted source task')
  }
  return parsed.data
}

export const resolveTrustedCmoSessionMemberAccess = async ({
  allowUnboundSession = false,
  context,
  database,
}: {
  readonly allowUnboundSession?: boolean
  readonly context: Pick<HookContext, 'session'> | Pick<ToolContext, 'session'>
  readonly database: Database
}): Promise<TrustedCmoSessionMemberAccess> => {
  const identity = readCmoSessionIdentity(context)
  const [binding] = await database
    .select({
      conversationSessionId: cmoConversations.sessionId,
      humanActorId: actors.id,
      humanActorKey: actors.actorKey,
      organizationId: brands.organizationId,
      role: member.role,
    })
    .from(brands)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, brands.organizationId),
        eq(member.userId, identity.userId)
      )
    )
    .innerJoin(
      cmoConversations,
      and(
        eq(cmoConversations.brandId, brands.id),
        eq(cmoConversations.id, identity.conversationId),
        eq(cmoConversations.ownerUserId, identity.userId)
      )
    )
    .innerJoin(
      actors,
      and(eq(actors.userId, identity.userId), eq(actors.type, 'human'))
    )
    .where(eq(brands.id, identity.brandId))
    .limit(1)
  if (
    binding === undefined ||
    (binding.conversationSessionId === null && !allowUnboundSession) ||
    (binding.conversationSessionId !== null &&
      binding.conversationSessionId !== context.session.id)
  ) {
    throw new Error('CMO session is outside the caller-owned conversation')
  }

  return {
    brandId: identity.brandId,
    conversationId: identity.conversationId,
    humanActorId: binding.humanActorId,
    humanActorKey: binding.humanActorKey,
    organizationId: binding.organizationId,
    role: memberRoleSchema.parse(binding.role),
    userId: identity.userId,
  }
}

export const resolveTrustedCmoTurnAccess = async ({
  context,
  database,
}: {
  readonly context: ToolContext
  readonly database: Database
}): Promise<TrustedCmoTurnAccess> => {
  if (context.session.parent !== undefined) {
    throw new Error('CMO canonical tools are root-only')
  }
  const binding = await resolveTrustedCmoSessionMemberAccess({
    context,
    database,
  })

  const [cmoActor] = await database
    .select({ actorKey: actors.actorKey, id: actors.id, type: actors.type })
    .from(actors)
    .where(eq(actors.actorKey, CMO_ACTOR_KEY))
    .limit(1)
  if (
    cmoActor === undefined ||
    cmoActor.actorKey !== CMO_ACTOR_KEY ||
    cmoActor.type !== 'agent'
  ) {
    throw new Error('The trusted CMO Actor is unavailable')
  }

  return {
    brandId: binding.brandId,
    callId: context.callId,
    cmoActorId: cmoActor.id,
    cmoActorKey: CMO_ACTOR_KEY,
    conversationId: binding.conversationId,
    humanActorId: binding.humanActorId,
    humanActorKey: binding.humanActorKey,
    organizationId: binding.organizationId,
    role: memberRoleSchema.parse(binding.role),
    rootSessionId: context.session.id,
    sessionId: context.session.id,
    turnId: context.session.turn.id,
    userId: binding.userId,
  }
}

export const stableCmoRequestId = ({
  context,
  operation,
  semantics,
}: {
  readonly context: Pick<ToolContext, 'session'>
  readonly operation: string
  readonly semantics: unknown
}): string => {
  const identity = readCmoSessionIdentity(context)
  return `eve:${operation}:${requestHash({
    brandId: identity.brandId,
    conversationId: identity.conversationId,
    operation,
    semantics,
    sessionId: context.session.id,
    turnId: context.session.turn.id,
    userId: identity.userId,
  })}`
}

const loadActiveIntentById = async ({
  brandId,
  database,
  intentId,
}: {
  readonly brandId: string
  readonly database: Database
  readonly intentId: string
}): Promise<ActiveIntentTarget> => {
  const [intent] = await database
    .select({ id: intents.id, revision: intents.revision })
    .from(intents)
    .where(
      and(
        eq(intents.brandId, brandId),
        eq(intents.id, intentId),
        eq(intents.status, 'active')
      )
    )
    .limit(1)
  if (intent === undefined) {
    throw new Error('The current CMO turn targets no active Intent')
  }
  return intent
}

const readCmoIntentActionTarget = ({
  action,
  scope,
}: {
  readonly action: CmoIntentActionCandidate
  readonly scope: CmoIntentProvenanceScope
}): string => {
  const receipt = cmoIntentReceiptSchema.safeParse(action.payload)
  const invalidProvenanceMessage =
    scope.kind === 'current-turn'
      ? 'The current CMO turn has invalid Intent provenance'
      : 'The current CMO conversation has invalid Intent provenance'
  if (
    !receipt.success ||
    action.actorKey !== CMO_ACTOR_KEY ||
    action.actorType !== 'agent' ||
    action.intentId === null ||
    action.intentId !== receipt.data.intentId ||
    action.sessionId === null ||
    action.sessionId !== receipt.data.producerContext.sessionId ||
    receipt.data.producerContext.conversationId !== scope.conversationId
  ) {
    throw new Error(invalidProvenanceMessage)
  }
  if (
    scope.kind === 'current-turn' &&
    (receipt.data.producerContext.sessionId !== scope.sessionId ||
      receipt.data.producerContext.turnId !== scope.turnId)
  ) {
    throw new Error(invalidProvenanceMessage)
  }
  return action.intentId
}

export const loadCmoIntentTarget = async ({
  context,
  database,
}: {
  readonly context: Pick<ToolContext, 'session'>
  readonly database: Database
}): Promise<ActiveIntentTarget> => {
  const identity = readCmoSessionIdentity(context)
  const currentTurnActions = await database
    .select({
      actorKey: actors.actorKey,
      actorType: actors.type,
      intentId: actions.intentId,
      payload: actions.payload,
      sessionId: actions.sessionId,
    })
    .from(actions)
    .innerJoin(actors, eq(actors.id, actions.actorId))
    .where(
      and(
        eq(actions.brandId, identity.brandId),
        eq(actions.sessionId, context.session.id),
        inArray(actions.type, CMO_INTENT_ACTION_TYPES),
        sql`${actions.payload} -> 'producerContext' ->> 'conversationId' = ${identity.conversationId}`,
        sql`${actions.payload} -> 'producerContext' ->> 'kind' = 'cmo-interactive'`,
        sql`${actions.payload} -> 'producerContext' ->> 'turnId' = ${context.session.turn.id}`
      )
    )

  const currentTurnIntentIds = new Set<string>()
  for (const action of currentTurnActions) {
    currentTurnIntentIds.add(
      readCmoIntentActionTarget({
        action,
        scope: {
          conversationId: identity.conversationId,
          kind: 'current-turn',
          sessionId: context.session.id,
          turnId: context.session.turn.id,
        },
      })
    )
  }
  if (currentTurnIntentIds.size > 1) {
    throw new Error('The current CMO turn identifies ambiguous active Intents')
  }
  const [currentTurnIntentId] = currentTurnIntentIds
  if (currentTurnIntentId !== undefined) {
    return await loadActiveIntentById({
      brandId: identity.brandId,
      database,
      intentId: currentTurnIntentId,
    })
  }

  const conversationIntentActions = await database
    .selectDistinctOn([actions.intentId], {
      actorKey: actors.actorKey,
      actorType: actors.type,
      intentId: actions.intentId,
      payload: actions.payload,
      revision: intents.revision,
      sessionId: actions.sessionId,
    })
    .from(actions)
    .innerJoin(actors, eq(actors.id, actions.actorId))
    .innerJoin(
      intents,
      and(
        eq(intents.brandId, actions.brandId),
        eq(intents.id, actions.intentId),
        eq(intents.status, 'active')
      )
    )
    .where(
      and(
        eq(actions.brandId, identity.brandId),
        inArray(actions.type, CMO_INTENT_ACTION_TYPES),
        sql`${actions.payload} -> 'producerContext' ->> 'conversationId' = ${identity.conversationId}`,
        sql`${actions.payload} -> 'producerContext' ->> 'kind' = 'cmo-interactive'`
      )
    )
    .orderBy(actions.intentId, desc(actions.createdAt), desc(actions.id))
    .limit(2)

  const conversationIntentTargets: ActiveIntentTarget[] = []
  for (const action of conversationIntentActions) {
    conversationIntentTargets.push({
      id: readCmoIntentActionTarget({
        action,
        scope: {
          conversationId: identity.conversationId,
          kind: 'conversation',
        },
      }),
      revision: action.revision,
    })
  }
  if (conversationIntentTargets.length > 1) {
    throw new Error(
      'The current CMO conversation identifies ambiguous active Intents'
    )
  }
  const [conversationIntentTarget] = conversationIntentTargets
  if (conversationIntentTarget !== undefined) {
    return conversationIntentTarget
  }

  const activeIntents = await database
    .select({ id: intents.id, revision: intents.revision })
    .from(intents)
    .where(
      and(eq(intents.brandId, identity.brandId), eq(intents.status, 'active'))
    )
    .orderBy(desc(intents.updatedAt), desc(intents.id))
    .limit(2)
  const [activeIntent] = activeIntents
  if (activeIntent === undefined) {
    throw new Error('The current brand has no active Intent')
  }
  if (activeIntents.length !== 1) {
    throw new Error('The current brand has ambiguous active Intents')
  }
  return activeIntent
}

export const loadCmoRefineIntentTarget = async ({
  context,
  database,
  requestId,
}: {
  readonly context: Pick<ToolContext, 'session'>
  readonly database: Database
  readonly requestId: string
}): Promise<ActiveIntentTarget> => {
  const identity = readCmoSessionIdentity(context)
  const [replayAction] = await database
    .select({
      actorKey: actors.actorKey,
      actorType: actors.type,
      intentId: actions.intentId,
      payload: actions.payload,
      sessionId: actions.sessionId,
    })
    .from(actions)
    .innerJoin(actors, eq(actors.id, actions.actorId))
    .where(
      and(
        eq(actions.brandId, identity.brandId),
        eq(actions.operationKey, operationKey('refine-intent:cmo', requestId)),
        eq(actions.type, 'intent_refined')
      )
    )
    .limit(1)
  if (replayAction !== undefined) {
    const receipt = cmoRefineIntentReceiptSchema.safeParse(replayAction.payload)
    if (!receipt.success) {
      throw new Error('The current CMO turn has invalid Intent provenance')
    }
    return {
      id: readCmoIntentActionTarget({
        action: replayAction,
        scope: {
          conversationId: identity.conversationId,
          kind: 'current-turn',
          sessionId: context.session.id,
          turnId: context.session.turn.id,
        },
      }),
      revision: receipt.data.before.revision,
    }
  }

  return await loadCmoIntentTarget({ context, database })
}

export const loadProductMarketerQuestionTaskId = async ({
  brandId,
  database,
  sourceTaskId,
}: {
  readonly brandId: string
  readonly database: Database
  readonly sourceTaskId: string
}): Promise<string> => {
  const [candidate] = await database
    .select({ completion: tasks.completion, taskId: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.id, sourceTaskId),
        eq(tasks.brandId, brandId),
        eq(tasks.kind, PRODUCT_MARKETER_TASK_KIND),
        eq(tasks.status, 'succeeded')
      )
    )
    .limit(1)

  const completion = productMarketerCompletionSchema.safeParse(
    candidate?.completion
  )
  if (candidate !== undefined && completion.success) {
    if (completion.data.status === 'completed') {
      throw new Error('The trusted source task has no open questions')
    }
    return candidate.taskId
  }
  throw new Error('The trusted source task has no question bundle')
}
