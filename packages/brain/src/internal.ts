import type { Database } from '@repo/db/client'
import { member } from '@repo/db/schema/auth'
import { actors, brands, cmoConversations } from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import type {
  MemberRole,
  TrustedCmoTurnAccess,
  TrustedMemberAccess,
  TrustedOrganizationAccess,
} from './context'
import { fail } from './errors'

export type BrainTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0]

const HUMAN_ACTOR_PREFIX = 'human:'

const persistedMemberRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer'])

export interface HumanActorBinding {
  readonly actorKey: string
  readonly id: string
}

export const ensureHumanActor = async (
  transaction: BrainTransaction,
  userId: string
): Promise<HumanActorBinding> => {
  const actorKey = `${HUMAN_ACTOR_PREFIX}${userId}`
  const [insertedActor] = await transaction
    .insert(actors)
    .values({ actorKey, type: 'human', userId })
    .onConflictDoNothing()
    .returning({
      actorKey: actors.actorKey,
      id: actors.id,
      type: actors.type,
      userId: actors.userId,
    })

  const [humanActor] =
    insertedActor === undefined
      ? await transaction
          .select({
            actorKey: actors.actorKey,
            id: actors.id,
            type: actors.type,
            userId: actors.userId,
          })
          .from(actors)
          .where(eq(actors.userId, userId))
          .for('share')
          .limit(1)
      : [insertedActor]

  if (
    humanActor?.type !== 'human' ||
    humanActor.userId !== userId ||
    humanActor.actorKey !== actorKey
  ) {
    return fail('access_denied', 'The global Human Actor binding is invalid')
  }

  return { actorKey: humanActor.actorKey, id: humanActor.id }
}

interface CurrentOrganizationMember {
  readonly role: MemberRole
  readonly userId: string
}

export const requireCurrentOrganizationMember = async (
  transaction: BrainTransaction,
  access: TrustedOrganizationAccess
): Promise<CurrentOrganizationMember> => {
  const [currentMember] = await transaction
    .select({ role: member.role, userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, access.organizationId),
        eq(member.userId, access.userId)
      )
    )
    .for('share')
    .limit(1)

  if (currentMember === undefined) {
    return fail(
      'access_denied',
      'A current organization membership is required'
    )
  }

  return {
    role: persistedMemberRoleSchema.parse(currentMember.role),
    userId: currentMember.userId,
  }
}

interface CurrentBrandMember extends CurrentOrganizationMember {
  readonly brandId: string
}

export const requireCurrentBrandMember = async (
  transaction: BrainTransaction,
  access: TrustedMemberAccess
): Promise<CurrentBrandMember> => {
  const [currentMember] = await transaction
    .select({
      brandId: brands.id,
      role: member.role,
      userId: member.userId,
    })
    .from(brands)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, brands.organizationId),
        eq(member.userId, access.userId)
      )
    )
    .where(
      and(
        eq(brands.id, access.brandId),
        eq(brands.organizationId, access.organizationId)
      )
    )
    .for('share')
    .limit(1)

  if (currentMember === undefined) {
    return fail(
      'access_denied',
      'The brand is outside the current organization'
    )
  }

  return {
    brandId: currentMember.brandId,
    role: persistedMemberRoleSchema.parse(currentMember.role),
    userId: currentMember.userId,
  }
}

export const requireTrustedHumanActor = async (
  transaction: BrainTransaction,
  access: TrustedMemberAccess
): Promise<void> => {
  const [humanActor] = await transaction
    .select({
      actorKey: actors.actorKey,
      type: actors.type,
      userId: actors.userId,
    })
    .from(actors)
    .where(eq(actors.id, access.humanActorId))
    .for('share')
    .limit(1)

  const isTrustedHuman =
    humanActor?.type === 'human' &&
    humanActor.userId === access.userId &&
    humanActor.actorKey === access.humanActorKey
  if (!isTrustedHuman) {
    fail('access_denied', 'The trusted Human Actor binding is invalid')
  }
}

export const requireTrustedAgentActor = async (
  transaction: BrainTransaction,
  actor: {
    readonly actorId: string
    readonly actorKey: string
  }
): Promise<void> => {
  const [persistedActor] = await transaction
    .select({ actorKey: actors.actorKey, type: actors.type })
    .from(actors)
    .where(eq(actors.id, actor.actorId))
    .for('share')
    .limit(1)

  if (
    persistedActor?.type !== 'agent' ||
    persistedActor.actorKey !== actor.actorKey
  ) {
    return fail('access_denied', 'The trusted Agent Actor binding is invalid')
  }
}

export const requireTrustedCmoTurn = async (
  transaction: BrainTransaction,
  access: TrustedCmoTurnAccess
): Promise<void> => {
  await requireTrustedAgentActor(transaction, {
    actorId: access.cmoActorId,
    actorKey: access.cmoActorKey,
  })

  const [conversation] = await transaction
    .select({
      ownerUserId: cmoConversations.ownerUserId,
      sessionId: cmoConversations.sessionId,
    })
    .from(cmoConversations)
    .where(
      and(
        eq(cmoConversations.id, access.conversationId),
        eq(cmoConversations.brandId, access.brandId),
        eq(cmoConversations.ownerUserId, access.userId)
      )
    )
    .for('share')
    .limit(1)

  if (conversation === undefined) {
    return fail(
      'access_denied',
      'The CMO turn is outside the caller-owned conversation'
    )
  }

  if (
    conversation.sessionId !== null &&
    conversation.sessionId !== access.rootSessionId
  ) {
    return fail('access_denied', 'The CMO root session binding is invalid')
  }
}

export const requireMutationRole = (role: MemberRole): void => {
  if (role === 'viewer') {
    fail('access_denied', 'Viewers cannot mutate canonical brand state')
  }
}
