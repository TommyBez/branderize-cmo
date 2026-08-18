import type { Database } from '@repo/db/client'
import { member } from '@repo/db/schema/auth'
import { actors, brands, cmoConversations } from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'

import {
  memberRoleSchema,
  type TrustedCmoTurnAccess,
  type TrustedMemberAccess,
} from './context'

const CMO_ACTOR_KEY = 'agent:cmo' as const

export interface CmoSessionIdentity {
  readonly brandId: string
  readonly conversationId: string
  readonly userId: string
}

export interface TrustedCmoSessionMemberAccess extends TrustedMemberAccess {
  readonly conversationId: string
}

interface CmoRootSessionIdentity extends CmoSessionIdentity {
  readonly sessionId: string
}

const loadCmoSessionMemberAccess = async ({
  database,
  identity,
}: {
  readonly database: Database
  readonly identity: CmoRootSessionIdentity
}): Promise<
  TrustedCmoSessionMemberAccess & {
    readonly boundSessionId: string | null
  }
> => {
  const [binding] = await database
    .select({
      boundSessionId: cmoConversations.sessionId,
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
  if (binding === undefined) {
    throw new Error('CMO session is outside the caller-owned conversation')
  }

  return {
    boundSessionId: binding.boundSessionId,
    brandId: identity.brandId,
    conversationId: identity.conversationId,
    humanActorId: binding.humanActorId,
    humanActorKey: binding.humanActorKey,
    organizationId: binding.organizationId,
    role: memberRoleSchema.parse(binding.role),
    userId: identity.userId,
  }
}

export const resolveInitialCmoSessionAccess = async ({
  database,
  identity,
}: {
  readonly database: Database
  readonly identity: CmoRootSessionIdentity
}): Promise<TrustedCmoSessionMemberAccess> => {
  const { boundSessionId, ...access } = await loadCmoSessionMemberAccess({
    database,
    identity,
  })
  if (boundSessionId !== null && boundSessionId !== identity.sessionId) {
    throw new Error('CMO session is outside the caller-owned conversation')
  }
  return access
}

export const resolveTrustedCmoTurnAccess = async ({
  database,
  identity,
}: {
  readonly database: Database
  readonly identity: CmoRootSessionIdentity & {
    readonly callId: string
    readonly turnId: string
  }
}): Promise<TrustedCmoTurnAccess> => {
  const { boundSessionId, ...access } = await loadCmoSessionMemberAccess({
    database,
    identity,
  })
  if (boundSessionId !== identity.sessionId) {
    throw new Error('CMO session is outside the caller-owned conversation')
  }

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
    ...access,
    callId: identity.callId,
    cmoActorId: cmoActor.id,
    cmoActorKey: CMO_ACTOR_KEY,
    rootSessionId: identity.sessionId,
    sessionId: identity.sessionId,
    turnId: identity.turnId,
  }
}
