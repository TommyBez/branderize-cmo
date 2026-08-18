import type { Database } from '@repo/db/client'
import { actions, actors, intents } from '@repo/db/schema/domain'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { operationKey } from './canonical'
import type { TrustedCmoTurnAccess } from './context'
import {
  declareIntentReceiptSchema,
  refineIntentReceiptSchema,
} from './intents'

const CMO_ACTOR_KEY = 'agent:cmo' as const
const CMO_INTENT_ACTION_TYPES = ['intent_declared', 'intent_refined'] as const
const cmoIntentReceiptSchema = z.discriminatedUnion('outcome', [
  declareIntentReceiptSchema,
  refineIntentReceiptSchema,
])

export interface ActiveIntentTarget {
  readonly id: string
  readonly revision: number
}

interface CmoIntentActionCandidate {
  readonly actorKey: string
  readonly actorType: string
  readonly callId: string | null
  readonly conversationId: string | null
  readonly intentId: string | null
  readonly payload: unknown
  readonly sessionId: string | null
  readonly turnId: string | null
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
    receipt.data.producerContext.kind !== 'cmo-interactive' ||
    action.actorKey !== CMO_ACTOR_KEY ||
    action.actorType !== 'agent' ||
    action.callId === null ||
    action.callId !== receipt.data.producerContext.callId ||
    action.conversationId === null ||
    action.conversationId !== receipt.data.producerContext.conversationId ||
    action.conversationId !== scope.conversationId ||
    action.intentId === null ||
    action.intentId !== receipt.data.intentId ||
    action.sessionId === null ||
    action.sessionId !== receipt.data.producerContext.sessionId ||
    action.turnId === null ||
    action.turnId !== receipt.data.producerContext.turnId
  ) {
    throw new Error(invalidProvenanceMessage)
  }
  if (
    scope.kind === 'current-turn' &&
    (action.sessionId !== scope.sessionId || action.turnId !== scope.turnId)
  ) {
    throw new Error(invalidProvenanceMessage)
  }
  return action.intentId
}

export const loadCmoIntentTarget = async ({
  access,
  database,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
}): Promise<ActiveIntentTarget> => {
  const currentTurnActions = await database
    .select({
      actorKey: actors.actorKey,
      actorType: actors.type,
      callId: actions.callId,
      conversationId: actions.conversationId,
      intentId: actions.intentId,
      payload: actions.payload,
      sessionId: actions.sessionId,
      turnId: actions.turnId,
    })
    .from(actions)
    .innerJoin(actors, eq(actors.id, actions.actorId))
    .where(
      and(
        eq(actions.brandId, access.brandId),
        eq(actions.conversationId, access.conversationId),
        eq(actions.sessionId, access.sessionId),
        eq(actions.turnId, access.turnId),
        inArray(actions.type, CMO_INTENT_ACTION_TYPES)
      )
    )

  const currentTurnIntentIds = new Set<string>()
  for (const action of currentTurnActions) {
    currentTurnIntentIds.add(
      readCmoIntentActionTarget({
        action,
        scope: {
          conversationId: access.conversationId,
          kind: 'current-turn',
          sessionId: access.sessionId,
          turnId: access.turnId,
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
      brandId: access.brandId,
      database,
      intentId: currentTurnIntentId,
    })
  }

  const conversationIntentActions = await database
    .selectDistinctOn([actions.intentId], {
      actorKey: actors.actorKey,
      actorType: actors.type,
      callId: actions.callId,
      conversationId: actions.conversationId,
      intentId: actions.intentId,
      payload: actions.payload,
      revision: intents.revision,
      sessionId: actions.sessionId,
      turnId: actions.turnId,
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
        eq(actions.brandId, access.brandId),
        eq(actions.conversationId, access.conversationId),
        inArray(actions.type, CMO_INTENT_ACTION_TYPES)
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
          conversationId: access.conversationId,
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
      and(eq(intents.brandId, access.brandId), eq(intents.status, 'active'))
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
  access,
  database,
  requestId,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
  readonly requestId: string
}): Promise<ActiveIntentTarget> => {
  const [replayAction] = await database
    .select({
      actorKey: actors.actorKey,
      actorType: actors.type,
      callId: actions.callId,
      conversationId: actions.conversationId,
      intentId: actions.intentId,
      payload: actions.payload,
      sessionId: actions.sessionId,
      turnId: actions.turnId,
    })
    .from(actions)
    .innerJoin(actors, eq(actors.id, actions.actorId))
    .where(
      and(
        eq(actions.brandId, access.brandId),
        eq(actions.operationKey, operationKey('refine-intent:cmo', requestId)),
        eq(actions.type, 'intent_refined')
      )
    )
    .limit(1)
  if (replayAction !== undefined) {
    const receipt = refineIntentReceiptSchema.safeParse(replayAction.payload)
    if (!receipt.success) {
      throw new Error('The current CMO turn has invalid Intent provenance')
    }
    return {
      id: readCmoIntentActionTarget({
        action: replayAction,
        scope: {
          conversationId: access.conversationId,
          kind: 'current-turn',
          sessionId: access.sessionId,
          turnId: access.turnId,
        },
      }),
      revision: receipt.data.before.revision,
    }
  }

  return await loadCmoIntentTarget({ access, database })
}
