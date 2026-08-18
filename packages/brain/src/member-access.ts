import type { Database } from '@repo/db/client'
import { member } from '@repo/db/schema/auth'
import { brands } from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'

import {
  memberRoleSchema,
  type TrustedMemberAccess,
  trustedMemberAccessSchema,
} from './context'
import { ensureHumanActor } from './internal'

export type TrustedMemberAccessMaterialization =
  | {
      readonly access: TrustedMemberAccess
      readonly kind: 'allowed'
    }
  | { readonly kind: 'denied' }

export const materializeTrustedMemberAccess = async ({
  brandId,
  database,
  userId,
}: {
  readonly brandId: string
  readonly database: Database
  readonly userId: string
}): Promise<TrustedMemberAccessMaterialization> =>
  await database.transaction(async (transaction) => {
    const [currentMember] = await transaction
      .select({
        brandId: brands.id,
        organizationId: brands.organizationId,
        role: member.role,
        userId: member.userId,
      })
      .from(brands)
      .innerJoin(
        member,
        and(
          eq(member.organizationId, brands.organizationId),
          eq(member.userId, userId)
        )
      )
      .where(eq(brands.id, brandId))
      .for('share')
      .limit(1)

    if (currentMember === undefined) {
      return { kind: 'denied' }
    }

    const role = memberRoleSchema.parse(currentMember.role)
    const humanActor = await ensureHumanActor(transaction, userId)
    const access = trustedMemberAccessSchema.parse({
      ...currentMember,
      humanActorId: humanActor.id,
      humanActorKey: humanActor.actorKey,
      role,
    })
    return { access, kind: 'allowed' }
  })
