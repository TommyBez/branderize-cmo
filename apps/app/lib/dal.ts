import 'server-only'

import {
  type ProductMarketerCompletion,
  productMarketerCompletionSchema,
} from '@repo/agents/tasks'
import {
  type MemberRole,
  memberRoleSchema,
  type TrustedMemberAccess,
} from '@repo/brain/context'
import { materializeTrustedMemberAccess } from '@repo/brain/member-access'
import {
  type BrandProjection,
  getBrandProjection,
} from '@repo/brain/projections'
import { db } from '@repo/db'
import { member, organization } from '@repo/db/schema/auth'
import { actions, brands, tasks } from '@repo/db/schema/domain'
import { and, desc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { auth } from './auth'

export class AppAccessError extends Error {
  readonly code: 'forbidden' | 'not_found' | 'unauthenticated'

  constructor(
    code: 'forbidden' | 'not_found' | 'unauthenticated',
    message: string
  ) {
    super(message)
    this.code = code
    this.name = 'AppAccessError'
  }
}

export type AuthenticatedSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>

const readAuthoritativeSession =
  async (): Promise<AuthenticatedSession | null> =>
    await auth.api.getSession({
      headers: await headers(),
      query: { disableCookieCache: true },
    })

const readCachedSession = cache(readAuthoritativeSession)

export const readPageSession = async (): Promise<AuthenticatedSession | null> =>
  await readCachedSession()

export const readRequestSession =
  async (): Promise<AuthenticatedSession | null> =>
    await readAuthoritativeSession()

export const requirePageSession = async (): Promise<AuthenticatedSession> => {
  const session = await readPageSession()
  if (session === null) {
    redirect('/sign-in')
  }
  return session
}

export const requireRequestSession =
  async (): Promise<AuthenticatedSession> => {
    const session = await readRequestSession()
    if (session === null) {
      throw new AppAccessError('unauthenticated', 'Authentication is required')
    }
    return session
  }

export interface OrganizationNavigationItem {
  readonly id: string
  readonly name: string
  readonly role: MemberRole
  readonly slug: string
}

export interface BrandNavigationItem {
  readonly id: string
  readonly name: string
  readonly organizationId: string
  readonly slug: string
}

export const listUserOrganizations = async (
  userId: string
): Promise<readonly OrganizationNavigationItem[]> => {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      role: member.role,
      slug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(organization.createdAt, organization.id)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: memberRoleSchema.parse(row.role),
    slug: row.slug,
  }))
}

export const listOrganizationBrands = async ({
  organizationId,
  userId,
}: {
  readonly organizationId: string
  readonly userId: string
}): Promise<readonly BrandNavigationItem[]> => {
  const rows = await db
    .select({
      id: brands.id,
      name: brands.name,
      organizationId: brands.organizationId,
      slug: brands.slug,
    })
    .from(brands)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, brands.organizationId),
        eq(member.userId, userId)
      )
    )
    .where(eq(brands.organizationId, organizationId))
    .orderBy(brands.createdAt, brands.id)

  return rows
}

export const firstAvailableBrand = async (
  userId: string
): Promise<BrandNavigationItem | null> => {
  const [brand] = await db
    .select({
      id: brands.id,
      name: brands.name,
      organizationId: brands.organizationId,
      slug: brands.slug,
    })
    .from(brands)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, brands.organizationId),
        eq(member.userId, userId)
      )
    )
    .orderBy(brands.createdAt, brands.id)
    .limit(1)

  return brand ?? null
}

export const requireOrganizationMembership = async ({
  organizationId,
  userId,
}: {
  readonly organizationId: string
  readonly userId: string
}): Promise<{ readonly role: MemberRole }> => {
  const [currentMembership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId))
    )
    .limit(1)

  if (currentMembership === undefined) {
    throw new AppAccessError(
      'forbidden',
      'The organization is not available to the current user'
    )
  }
  return { role: memberRoleSchema.parse(currentMembership.role) }
}

const buildTrustedMemberAccess = async ({
  brandId,
  userId,
}: {
  readonly brandId: string
  readonly userId: string
}): Promise<TrustedMemberAccess> => {
  const result = await materializeTrustedMemberAccess({
    brandId,
    database: db,
    userId,
  })

  if (result.kind === 'denied') {
    throw new AppAccessError(
      'not_found',
      'The brand is not available to the current user'
    )
  }

  return result.access
}

export interface BrandPageContext {
  readonly access: TrustedMemberAccess
  readonly brand: BrandProjection
  readonly brands: readonly BrandNavigationItem[]
  readonly session: AuthenticatedSession
}

const loadBrandPageContext = async (
  brandId: string
): Promise<BrandPageContext> => {
  const session = await requirePageSession()
  const access = await buildTrustedMemberAccess({
    brandId,
    userId: session.user.id,
  })
  const [brand, navigationBrands] = await Promise.all([
    getBrandProjection({ access, database: db }),
    listOrganizationBrands({
      organizationId: access.organizationId,
      userId: session.user.id,
    }),
  ])

  return { access, brand, brands: navigationBrands, session }
}

export const requireBrandPageContext = cache(loadBrandPageContext)

export const requireBrandRequestContext = async (
  brandId: string
): Promise<{
  readonly access: TrustedMemberAccess
  readonly session: AuthenticatedSession
}> => {
  const session = await requireRequestSession()
  const access = await buildTrustedMemberAccess({
    brandId,
    userId: session.user.id,
  })
  return { access, session }
}

export type TaskCompletionProjection =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'valid'
      readonly value: ProductMarketerCompletion
    }
  | { readonly kind: 'invalid' }

export interface ProductMarketerTaskProjection {
  readonly completion: TaskCompletionProjection
  readonly createdAt: Date
  readonly finishedAt: Date | null
  readonly id: string
  readonly intentId: string | null
  readonly kind: string
  readonly startedAt: Date | null
  readonly status:
    | 'awaiting_approval'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'superseded'
    | 'outcome_unknown'
    | 'expired'
    | 'needs_regeneration'
    | 'dismissed'
  readonly updatedAt: Date
}

export interface ProductMarketerTaskDetailProjection
  extends ProductMarketerTaskProjection {
  readonly questionResolution: {
    readonly actionId: string
    readonly resolvedAt: Date
  } | null
}

const projectCompletion = (value: unknown): TaskCompletionProjection => {
  if (value === null) {
    return { kind: 'none' }
  }
  const parsed = productMarketerCompletionSchema.safeParse(value)
  return parsed.success
    ? { kind: 'valid', value: parsed.data }
    : { kind: 'invalid' }
}

const taskSelection = {
  completion: tasks.completion,
  createdAt: tasks.createdAt,
  finishedAt: tasks.finishedAt,
  id: tasks.id,
  intentId: tasks.intentId,
  kind: tasks.kind,
  startedAt: tasks.startedAt,
  status: tasks.status,
  updatedAt: tasks.updatedAt,
}

export const listProductMarketerTasks = async ({
  access,
  limit = 30,
}: {
  readonly access: TrustedMemberAccess
  readonly limit?: number
}): Promise<readonly ProductMarketerTaskProjection[]> => {
  await getBrandProjection({ access, database: db })
  const rows = await db
    .select(taskSelection)
    .from(tasks)
    .where(
      and(
        eq(tasks.brandId, access.brandId),
        eq(tasks.kind, 'product-marketer.brand-context.v1')
      )
    )
    .orderBy(desc(tasks.createdAt), desc(tasks.id))
    .limit(Math.min(Math.max(limit, 1), 100))

  return rows.map((row) => ({
    ...row,
    completion: projectCompletion(row.completion),
  }))
}

export const getProductMarketerTask = async ({
  access,
  taskId,
}: {
  readonly access: TrustedMemberAccess
  readonly taskId: string
}): Promise<ProductMarketerTaskDetailProjection | null> => {
  await getBrandProjection({ access, database: db })
  const [row] = await db
    .select({
      ...taskSelection,
      resolutionActionId: actions.id,
      resolvedAt: actions.createdAt,
    })
    .from(tasks)
    .leftJoin(
      actions,
      and(
        eq(actions.brandId, tasks.brandId),
        eq(actions.taskId, tasks.id),
        eq(actions.type, 'task_questions_resolved')
      )
    )
    .where(
      and(
        eq(tasks.brandId, access.brandId),
        eq(tasks.id, taskId),
        eq(tasks.kind, 'product-marketer.brand-context.v1')
      )
    )
    .limit(1)

  if (row === undefined) {
    return null
  }

  const { resolutionActionId, resolvedAt, ...task } = row
  const questionResolution =
    resolutionActionId === null || resolvedAt === null
      ? null
      : {
          actionId: resolutionActionId,
          resolvedAt,
        }
  return {
    ...task,
    completion: projectCompletion(task.completion),
    questionResolution,
  }
}
