import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { createBranderizeAuth } from '@repo/auth/server'
import { createBrandOnboarding } from '@repo/brain/onboarding'
import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { member, organization, user } from '@repo/db/schema/auth'
import { actions, brands, intents } from '@repo/db/schema/domain'
import { executeStatementsSequentially } from '@repo/db/test-support'
import { and, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  OnboardingOrganizationConflictError,
  resolveOnboardingOrganization,
} from './onboarding-organization'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const schemaName = `app_onboarding_${randomUUID().replaceAll('-', '_')}`

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined
let testAuth: ReturnType<typeof createBranderizeAuth> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The onboarding integration database is unavailable')
  }
  return database
}

const requireAuth = (): ReturnType<typeof createBranderizeAuth> => {
  if (testAuth === undefined) {
    throw new Error('The onboarding integration auth instance is unavailable')
  }
  return testAuth
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for app integration tests')
  }

  adminPool = createDatabasePool({ connectionString: databaseUrl, max: 1 })
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`)

  const scopedUrl = new URL(databaseUrl)
  scopedUrl.searchParams.set('options', `-c search_path=${schemaName},public`)
  const scopedDatabasePool = createDatabasePool({
    connectionString: scopedUrl.toString(),
    max: 6,
  })
  databasePool = scopedDatabasePool
  database = createDatabase(scopedDatabasePool)

  const migration = await readFile(
    new URL(
      '../../../packages/db/drizzle/0000_phase0_foundation.sql',
      import.meta.url
    ),
    'utf8'
  )
  const statements = migration
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
  await executeStatementsSequentially({
    execute: (statement) => scopedDatabasePool.query(statement),
    statements,
  })

  testAuth = createBranderizeAuth({
    database: requireDatabase(),
    environment: {
      BETTER_AUTH_SECRET:
        'phase0-onboarding-integration-secret-at-least-thirty-two-bytes',
      BETTER_AUTH_TRUSTED_ORIGINS: ['http://localhost:3001'],
      BETTER_AUTH_URL: 'http://localhost:3001',
      GOOGLE_CLIENT_ID: 'integration-google-client',
      GOOGLE_CLIENT_SECRET: 'integration-google-secret',
    },
  })
})

afterAll(async () => {
  await databasePool?.end()
  if (adminPool !== undefined) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await adminPool.end()
  }
})

interface OnboardingFixture {
  readonly brandName: string
  readonly brandSlug: string
  readonly intentStatement: string
  readonly organizationName: string
  readonly organizationSlug: string
  readonly requestId: string
  readonly userId: string
  readonly websiteUrl: string
}

const createFixture = async (): Promise<OnboardingFixture> => {
  const unique = randomUUID()
  const userId = `user:${unique}`
  await requireDatabase()
    .insert(user)
    .values({
      email: `${unique}@example.test`,
      id: userId,
      name: 'Onboarding owner',
    })
  return {
    brandName: `Brand ${unique}`,
    brandSlug: `brand-${unique}`,
    intentStatement: 'Create one canonical brand despite a lost response.',
    organizationName: `Organization ${unique}`,
    organizationSlug: `organization-${unique}`,
    requestId: `request:${unique}`,
    userId,
    websiteUrl: `https://${unique}.example.test`,
  }
}

const createOrganizationFactory = (fixture: OnboardingFixture) =>
  vi.fn(
    async ({ metadata, name, slug }) =>
      await requireAuth().api.createOrganization({
        body: { metadata, name, slug, userId: fixture.userId },
      })
  )

const runBrainOnboarding = async ({
  fixture,
  organizationId,
}: {
  readonly fixture: OnboardingFixture
  readonly organizationId: string
}) =>
  await createBrandOnboarding({
    access: { organizationId, userId: fixture.userId },
    database: requireDatabase(),
    input: {
      brandName: fixture.brandName,
      brandSlug: fixture.brandSlug,
      intentStatement: fixture.intentStatement,
      requestId: fixture.requestId,
      websiteUrl: fixture.websiteUrl,
    },
  })

const expectCanonicalCounts = async ({
  brandId,
  fixture,
  organizationId,
}: {
  readonly brandId: string
  readonly fixture: OnboardingFixture
  readonly organizationId: string
}): Promise<void> => {
  const currentDatabase = requireDatabase()
  const [
    [organizationCount],
    [membershipCount],
    [brandCount],
    [intentCount],
    [actionCount],
  ] = await Promise.all([
    currentDatabase
      .select({ total: count() })
      .from(organization)
      .where(eq(organization.slug, fixture.organizationSlug)),
    currentDatabase
      .select({ total: count() })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, fixture.userId)
        )
      ),
    currentDatabase
      .select({ total: count() })
      .from(brands)
      .where(eq(brands.organizationId, organizationId)),
    currentDatabase
      .select({ total: count() })
      .from(intents)
      .where(eq(intents.brandId, brandId)),
    currentDatabase
      .select({ total: count() })
      .from(actions)
      .where(
        and(eq(actions.brandId, brandId), eq(actions.type, 'intent_declared'))
      ),
  ])

  expect(organizationCount?.total).toBe(1)
  expect(membershipCount?.total).toBe(1)
  expect(brandCount?.total).toBe(1)
  expect(intentCount?.total).toBe(1)
  expect(actionCount?.total).toBe(1)
}

describe('onboarding Organization lost-response recovery on PostgreSQL', () => {
  it('serializes concurrent first submissions on the organization slug', async () => {
    const fixture = await createFixture()
    const createOrganization = createOrganizationFactory(fixture)

    const [firstOrganizationId, secondOrganizationId] = await Promise.all([
      resolveOnboardingOrganization({
        createOrganization,
        database: requireDatabase(),
        input: fixture,
      }),
      resolveOnboardingOrganization({
        createOrganization,
        database: requireDatabase(),
        input: fixture,
      }),
    ])

    expect(secondOrganizationId).toBe(firstOrganizationId)
    expect(createOrganization).toHaveBeenCalledTimes(1)
  })

  it('never adopts an organization created by different semantics', async () => {
    const fixture = await createFixture()
    await resolveOnboardingOrganization({
      createOrganization: createOrganizationFactory(fixture),
      database: requireDatabase(),
      input: fixture,
    })
    const conflictingFixture = await createFixture()
    const conflictingCreate = createOrganizationFactory(conflictingFixture)

    await expect(
      resolveOnboardingOrganization({
        createOrganization: conflictingCreate,
        database: requireDatabase(),
        input: {
          ...conflictingFixture,
          organizationSlug: fixture.organizationSlug,
        },
      })
    ).rejects.toBeInstanceOf(OnboardingOrganizationConflictError)
    expect(conflictingCreate).not.toHaveBeenCalled()
  })

  it('recovers the exact Better Auth Organization before the Brain receipt exists', async () => {
    const fixture = await createFixture()
    const createOrganization = createOrganizationFactory(fixture)
    const organizationId = await resolveOnboardingOrganization({
      createOrganization,
      database: requireDatabase(),
      input: fixture,
    })

    const replayedOrganizationId = await resolveOnboardingOrganization({
      createOrganization,
      database: requireDatabase(),
      input: fixture,
    })
    const receipt = await runBrainOnboarding({
      fixture,
      organizationId: replayedOrganizationId,
    })

    expect(replayedOrganizationId).toBe(organizationId)
    expect(createOrganization).toHaveBeenCalledTimes(1)
    await expectCanonicalCounts({
      brandId: receipt.brandId,
      fixture,
      organizationId,
    })
  })

  it('replays both the Organization identity and Brain receipt after commit', async () => {
    const fixture = await createFixture()
    const createOrganization = createOrganizationFactory(fixture)
    const organizationId = await resolveOnboardingOrganization({
      createOrganization,
      database: requireDatabase(),
      input: fixture,
    })
    const firstReceipt = await runBrainOnboarding({ fixture, organizationId })

    const replayedOrganizationId = await resolveOnboardingOrganization({
      createOrganization,
      database: requireDatabase(),
      input: fixture,
    })
    const replayedReceipt = await runBrainOnboarding({
      fixture,
      organizationId: replayedOrganizationId,
    })

    expect(replayedOrganizationId).toBe(organizationId)
    expect(replayedReceipt).toEqual(firstReceipt)
    expect(createOrganization).toHaveBeenCalledTimes(1)
    await expectCanonicalCounts({
      brandId: firstReceipt.brandId,
      fixture,
      organizationId,
    })
  })
})
