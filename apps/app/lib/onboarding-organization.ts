import 'server-only'

import { operationKey, requestHash } from '@repo/brain/canonical'
import type { Database } from '@repo/db/client'
import { member, organization } from '@repo/db/schema/auth'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

const MARKER_VERSION = 1
const MARKER_PROPERTY = 'branderizeOnboarding'

const nonBlankSchema = z.string().trim().min(1)
const organizationSlugSchema = nonBlankSchema
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
const onboardingOrganizationInputSchema = z
  .object({
    brandName: nonBlankSchema.max(160),
    brandSlug: organizationSlugSchema,
    intentStatement: nonBlankSchema.max(2000),
    organizationName: nonBlankSchema.max(160),
    organizationSlug: organizationSlugSchema,
    requestId: nonBlankSchema.max(500),
    userId: nonBlankSchema.max(500),
    websiteUrl: z.url(),
  })
  .strict()

const onboardingOrganizationMarkerSchema = z
  .object({
    creatorUserId: nonBlankSchema.max(500),
    operationKey: nonBlankSchema.max(256),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
    version: z.literal(MARKER_VERSION),
  })
  .strict()

type OnboardingOrganizationMarker = z.infer<
  typeof onboardingOrganizationMarkerSchema
>

export type OnboardingOrganizationInput = z.input<
  typeof onboardingOrganizationInputSchema
>

export class OnboardingOrganizationConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OnboardingOrganizationConflictError'
  }
}

interface CreateOrganizationInput {
  readonly metadata: Readonly<Record<string, unknown>>
  readonly name: string
  readonly slug: string
}

const readMarker = (
  metadata: string | null
): OnboardingOrganizationMarker | null => {
  if (metadata === null) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(metadata)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null
    }
    const marker = Reflect.get(parsed, MARKER_PROPERTY)
    const result = onboardingOrganizationMarkerSchema.safeParse(marker)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

const markersMatch = (
  actual: OnboardingOrganizationMarker | null,
  expected: OnboardingOrganizationMarker
): boolean =>
  actual !== null &&
  actual.creatorUserId === expected.creatorUserId &&
  actual.operationKey === expected.operationKey &&
  actual.requestHash === expected.requestHash &&
  actual.version === expected.version

const createIdentity = (
  input: z.infer<typeof onboardingOrganizationInputSchema>
): OnboardingOrganizationMarker => ({
  creatorUserId: input.userId,
  operationKey: operationKey('brand-onboarding', input.requestId),
  requestHash: requestHash({
    brandName: input.brandName,
    brandSlug: input.brandSlug,
    intentStatement: input.intentStatement,
    organizationName: input.organizationName,
    organizationSlug: input.organizationSlug,
    userId: input.userId,
    websiteUrl: input.websiteUrl,
  }),
  version: MARKER_VERSION,
})

export const resolveOnboardingOrganization = async ({
  createOrganization,
  database,
  input,
}: {
  readonly createOrganization: (
    input: CreateOrganizationInput
  ) => Promise<{ readonly id: string }>
  readonly database: Database
  readonly input: OnboardingOrganizationInput
}): Promise<string> => {
  const parsed = onboardingOrganizationInputSchema.parse(input)
  const marker = createIdentity(parsed)
  const lockKey = `brand-onboarding-organization:${parsed.organizationSlug}`

  return await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
    )

    const readExisting = async (): Promise<string | null> => {
      const [existing] = await transaction
        .select({
          id: organization.id,
          memberId: member.id,
          metadata: organization.metadata,
        })
        .from(organization)
        .leftJoin(
          member,
          and(
            eq(member.organizationId, organization.id),
            eq(member.userId, parsed.userId)
          )
        )
        .where(eq(organization.slug, parsed.organizationSlug))
        .limit(1)

      if (existing === undefined) {
        return null
      }
      if (
        existing.memberId === null ||
        !markersMatch(readMarker(existing.metadata), marker)
      ) {
        throw new OnboardingOrganizationConflictError(
          'The organization slug belongs to a different operation'
        )
      }
      return existing.id
    }

    const replay = await readExisting()
    if (replay !== null) {
      return replay
    }

    let created: { readonly id: string }
    try {
      created = await createOrganization({
        metadata: { [MARKER_PROPERTY]: marker },
        name: parsed.organizationName,
        slug: parsed.organizationSlug,
      })
    } catch (error) {
      const recovered = await readExisting()
      if (recovered !== null) {
        return recovered
      }
      throw error
    }

    const persisted = await readExisting()
    if (persisted === null || persisted !== created.id) {
      throw new OnboardingOrganizationConflictError(
        'The created organization did not preserve its operation identity'
      )
    }
    return persisted
  })
}
