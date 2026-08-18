import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { member, organization, user } from '@repo/db/schema/auth'
import {
  actions,
  actors,
  brands,
  intents,
  objects,
  tasks,
} from '@repo/db/schema/domain'
import { and, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type {
  TrustedCmoTurnAccess,
  TrustedMemberAccess,
  TrustedOrganizationAccess,
} from './context'
import { bindCmoSession, createCmoConversation } from './conversations'
import { BrainError } from './errors'
import { refineIntent } from './intents'
import {
  CONTEXT_BOOTSTRAP_CLAIM_STALE_AFTER_MS,
  claimContextBootstrap,
  commitContextBootstrap,
  recoverContextBootstrapClaim,
} from './objects'
import { createBrandOnboarding } from './onboarding'
import { getBrandImportStatus } from './projections'
import {
  PRODUCT_MARKETER_TASK_KIND,
  requestSpecialistWork,
  resolveTaskQuestions,
} from './tasks'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const TEST_TIMEOUT_MS = 30_000
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001'
const SYSTEM_ACTOR_KEY = 'system:context-dev' as const
const CMO_ACTOR_ID = '00000000-0000-0000-0000-000000000101'
const CMO_ACTOR_KEY = 'agent:cmo' as const
const ARTIFACT_SHA = 'a'.repeat(64)
const schemaName = `brain_receipts_${randomUUID().replaceAll('-', '_')}`

interface BrandFixture {
  readonly access: TrustedMemberAccess
  readonly brandId: string
  readonly intentId: string
  readonly websiteUrl: string
}

interface OrganizationFixture {
  readonly access: TrustedOrganizationAccess
  readonly organizationId: string
  readonly userId: string
}

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The operation receipt integration database is unavailable')
  }
  return database
}

const createOrganizationFixture = async (): Promise<OrganizationFixture> => {
  const unique = randomUUID()
  const organizationId = `organization:${unique}`
  const userId = `user:${unique}`
  const currentDatabase = requireDatabase()

  await currentDatabase.insert(user).values({
    email: `${unique}@example.test`,
    id: userId,
    name: 'Receipt race owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'Receipt race organization',
    slug: `receipt-race-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role: 'owner',
    userId,
  })

  return {
    access: { organizationId, userId },
    organizationId,
    userId,
  }
}

const createBrandFixture = async (): Promise<BrandFixture> => {
  const unique = randomUUID()
  const actorId = randomUUID()
  const brandId = randomUUID()
  const intentId = randomUUID()
  const organizationFixture = await createOrganizationFixture()
  const websiteUrl = `https://receipts-${unique}.example.test`
  const currentDatabase = requireDatabase()

  await currentDatabase.insert(brands).values({
    id: brandId,
    name: 'Receipt race brand',
    organizationId: organizationFixture.organizationId,
    slug: `receipt-race-${unique}`,
    websiteUrl,
  })
  await currentDatabase.insert(actors).values({
    actorKey: `human:${organizationFixture.userId}`,
    id: actorId,
    type: 'human',
    userId: organizationFixture.userId,
  })
  await currentDatabase.insert(intents).values({
    authorActorId: actorId,
    brandId,
    id: intentId,
    parentIntentId: null,
    revision: 1,
    statement: 'Prove exact operation replay under concurrency.',
    status: 'active',
  })

  return {
    access: {
      brandId,
      humanActorId: actorId,
      humanActorKey: `human:${organizationFixture.userId}`,
      organizationId: organizationFixture.organizationId,
      role: 'owner',
      userId: organizationFixture.userId,
    },
    brandId,
    intentId,
    websiteUrl,
  }
}

const countActions = async ({
  brandId,
  type,
}: {
  readonly brandId: string
  readonly type: string
}): Promise<number> => {
  const [result] = await requireDatabase()
    .select({ total: count() })
    .from(actions)
    .where(and(eq(actions.brandId, brandId), eq(actions.type, type)))
  if (result === undefined) {
    throw new Error('The receipt race count query returned no row')
  }
  return result.total
}

const countObjects = async (brandId: string): Promise<number> => {
  const [result] = await requireDatabase()
    .select({ total: count() })
    .from(objects)
    .where(eq(objects.brandId, brandId))
  if (result === undefined) {
    throw new Error('The receipt race Object count query returned no row')
  }
  return result.total
}

const countTasks = async (brandId: string): Promise<number> => {
  const [result] = await requireDatabase()
    .select({ total: count() })
    .from(tasks)
    .where(eq(tasks.brandId, brandId))
  if (result === undefined) {
    throw new Error('The receipt race task count query returned no row')
  }
  return result.total
}

const countOrganizationBrands = async (
  organizationId: string
): Promise<number> => {
  const [result] = await requireDatabase()
    .select({ total: count() })
    .from(brands)
    .where(eq(brands.organizationId, organizationId))
  if (result === undefined) {
    throw new Error('The receipt race brand count query returned no row')
  }
  return result.total
}

const requireOperationConflict = (reason: unknown): void => {
  expect(reason).toBeInstanceOf(BrainError)
  if (!(reason instanceof BrainError)) {
    throw new Error('The rejected receipt race did not return a BrainError')
  }
  expect(reason.code).toBe('operation_conflict')
}

const requireAlreadyClaimed = (reason: unknown): void => {
  expect(reason).toBeInstanceOf(BrainError)
  if (!(reason instanceof BrainError)) {
    throw new Error('The rejected Context import claim returned no BrainError')
  }
  expect(reason.code).toBe('already_claimed')
}

const createBoundCmoTurnAccess = async ({
  access,
  title,
}: {
  readonly access: TrustedMemberAccess
  readonly title: string
}): Promise<TrustedCmoTurnAccess> => {
  const conversation = await createCmoConversation({
    access,
    database: requireDatabase(),
    input: { title },
  })
  const sessionId = `session:${randomUUID()}`
  await bindCmoSession({
    access,
    database: requireDatabase(),
    input: {
      conversationId: conversation.id,
      sessionId,
      source: 'proxy-create-response',
    },
  })
  return {
    ...access,
    callId: `call:${randomUUID()}`,
    cmoActorId: CMO_ACTOR_ID,
    cmoActorKey: CMO_ACTOR_KEY,
    conversationId: conversation.id,
    rootSessionId: sessionId,
    sessionId,
    turnId: `turn:${randomUUID()}`,
  }
}

const createAdditionalBrandMember = async (
  fixture: BrandFixture
): Promise<TrustedMemberAccess> => {
  const unique = randomUUID()
  const userId = `user:${unique}`
  const humanActorId = randomUUID()
  await requireDatabase()
    .insert(user)
    .values({
      email: `${unique}@example.test`,
      id: userId,
      name: 'Second receipt race member',
    })
  await requireDatabase()
    .insert(member)
    .values({
      id: `member:${unique}`,
      organizationId: fixture.access.organizationId,
      role: 'member',
      userId,
    })
  await requireDatabase()
    .insert(actors)
    .values({
      actorKey: `human:${userId}`,
      id: humanActorId,
      type: 'human',
      userId,
    })
  return {
    brandId: fixture.brandId,
    humanActorId,
    humanActorKey: `human:${userId}`,
    organizationId: fixture.access.organizationId,
    role: 'member',
    userId,
  }
}

const createOpenQuestionTask = async ({
  fixture,
  question,
}: {
  readonly fixture: BrandFixture
  readonly question: string
}): Promise<{
  readonly access: TrustedCmoTurnAccess
  readonly taskId: string
}> => {
  const access = await createBoundCmoTurnAccess({
    access: fixture.access,
    title: 'Concurrent question resolution',
  })
  const requested = await requestSpecialistWork({
    access,
    database: requireDatabase(),
    input: {
      intentId: fixture.intentId,
      kind: PRODUCT_MARKETER_TASK_KIND,
      payload: { purpose: 'enrich_brand_context' },
      requestId: `specialist:${randomUUID()}`,
    },
  })
  await requireDatabase()
    .update(tasks)
    .set({
      completion: {
        intentAcceptance: null,
        openQuestions: [question],
        outputObjectIds: [],
        result: {
          outcome: 'needs_input',
          reason: 'missing_human_context',
        },
        status: 'blocked',
        summary: 'The Product Marketer needs one explicit human answer.',
      },
      finishedAt: new Date(),
      outcomeCode: 'blocked',
      status: 'succeeded',
    })
    .where(eq(tasks.id, requested.taskId))

  return { access, taskId: requested.taskId }
}

const applyMigrationStatements = async ({
  index = 0,
  pool,
  statements,
}: {
  readonly index?: number
  readonly pool: ReturnType<typeof createDatabasePool>
  readonly statements: readonly string[]
}): Promise<void> => {
  const statement = statements[index]
  if (statement === undefined) {
    return
  }
  await pool.query(statement)
  await applyMigrationStatements({ index: index + 1, pool, statements })
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for receipt integration tests')
  }

  adminPool = createDatabasePool({ connectionString: databaseUrl, max: 1 })
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`)

  const scopedUrl = new URL(databaseUrl)
  scopedUrl.searchParams.set('options', `-c search_path=${schemaName},public`)
  databasePool = createDatabasePool({
    connectionString: scopedUrl.toString(),
    max: 6,
  })
  database = createDatabase(databasePool)

  const migration = await readFile(
    new URL('../../db/drizzle/0000_phase0_foundation.sql', import.meta.url),
    'utf8'
  )
  const statements = migration
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
  await applyMigrationStatements({ pool: databasePool, statements })

  await databasePool.query(`
    CREATE FUNCTION delay_action_receipt_insert() RETURNS trigger AS $$
    BEGIN
      IF NEW.operation_key IS NOT NULL THEN
        PERFORM pg_sleep(0.15);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `)
  await databasePool.query(`
    CREATE TRIGGER delay_action_receipt_insert
    BEFORE INSERT ON actions
    FOR EACH ROW EXECUTE FUNCTION delay_action_receipt_insert()
  `)
})

afterAll(async () => {
  await databasePool?.end()
  if (adminPool !== undefined) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await adminPool.end()
  }
})

describe('Action operation receipts on PostgreSQL', () => {
  it('returns one onboarding receipt instead of a brand slug conflict', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const organizationFixture = await createOrganizationFixture()
    const unique = randomUUID()
    const input = {
      brandName: 'Concurrent onboarding brand',
      brandSlug: `concurrent-onboarding-${unique}`,
      intentStatement: 'Create this brand exactly once.',
      requestId: `onboarding:${unique}`,
      websiteUrl: `https://onboarding-${unique}.example.test`,
    }
    const operation = () =>
      createBrandOnboarding({
        access: organizationFixture.access,
        database: requireDatabase(),
        input,
      })

    const [first, second] = await Promise.all([operation(), operation()])

    expect(second).toEqual(first)
    expect(
      await countOrganizationBrands(organizationFixture.organizationId)
    ).toBe(1)
    expect(
      await countActions({
        brandId: first.brandId,
        type: 'intent_declared',
      })
    ).toBe(1)
  })

  it('rejects divergent onboarding hashes before creating a second brand', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const organizationFixture = await createOrganizationFixture()
    const requestId = `onboarding:${randomUUID()}`
    const operation = (variant: 'first' | 'second') =>
      createBrandOnboarding({
        access: organizationFixture.access,
        database: requireDatabase(),
        input: {
          brandName: `${variant} onboarding brand`,
          brandSlug: `${variant}-onboarding-${randomUUID()}`,
          intentStatement: `Create the ${variant} semantic request.`,
          requestId,
          websiteUrl: `https://${variant}-${randomUUID()}.example.test`,
        },
      })

    const results = await Promise.allSettled([
      operation('first'),
      operation('second'),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.find((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status !== 'rejected') {
      throw new Error('The divergent onboarding receipt race succeeded')
    }
    requireOperationConflict(rejected.reason)
    expect(
      await countOrganizationBrands(organizationFixture.organizationId)
    ).toBe(1)
  })

  it('fails closed when different operation keys target the same brand slug', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const organizationFixture = await createOrganizationFixture()
    const unique = randomUUID()
    const operation = (requestId: string) =>
      createBrandOnboarding({
        access: organizationFixture.access,
        database: requireDatabase(),
        input: {
          brandName: 'Shared slug brand',
          brandSlug: `shared-slug-${unique}`,
          intentStatement: 'Create one canonical brand for this slug.',
          requestId,
          websiteUrl: `https://shared-slug-${unique}.example.test`,
        },
      })

    const results = await Promise.allSettled([
      operation(`onboarding:first:${unique}`),
      operation(`onboarding:second:${unique}`),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.find((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status !== 'rejected') {
      throw new Error('The shared-slug onboarding race unexpectedly succeeded')
    }
    requireOperationConflict(rejected.reason)
    expect(
      await countOrganizationBrands(organizationFixture.organizationId)
    ).toBe(1)
  })

  it('grants one Context import claim and recovers it without a receipt', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const currentPool = databasePool
    if (currentPool === undefined) {
      throw new Error('The receipt integration pool is unavailable')
    }
    const versionResult = await currentPool.query<{
      server_version: string
    }>('SHOW server_version')
    expect(versionResult.rows[0]?.server_version.split('.')[0]).toBe('17')

    const fixture = await createBrandFixture()
    const operation = () =>
      claimContextBootstrap({
        access: fixture.access,
        database: requireDatabase(),
      })
    const results = await Promise.allSettled([operation(), operation()])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.find((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(fulfilled[0]).toMatchObject({
      value: {
        brandId: fixture.brandId,
        claimedAt: expect.any(Date),
        kind: 'claimed',
        systemActorId: SYSTEM_ACTOR_ID,
        websiteUrl: fixture.websiteUrl,
      },
    })
    const winningClaim = fulfilled[0]?.value
    if (winningClaim?.kind !== 'claimed') {
      throw new Error('The Context import race returned no winning claim')
    }
    if (rejected?.status !== 'rejected') {
      throw new Error('Both concurrent Context import claims succeeded')
    }
    requireAlreadyClaimed(rejected.reason)

    const [claimedBrand] = await requireDatabase()
      .select({ onboardingStatus: brands.onboardingStatus })
      .from(brands)
      .where(eq(brands.id, fixture.brandId))
      .limit(1)
    expect(claimedBrand).toEqual({ onboardingStatus: 'importing' })
    await expect(
      getBrandImportStatus({
        access: fixture.access,
        database: requireDatabase(),
      })
    ).resolves.toEqual({
      currentBrandContextObjectId: null,
      kind: 'importing',
      retryAvailable: false,
    })
    expect(
      await countActions({
        brandId: fixture.brandId,
        type: 'context_bootstrapped',
      })
    ).toBe(0)
    expect(await countObjects(fixture.brandId)).toBe(0)

    const systemAccess = {
      brandId: fixture.brandId,
      systemActorId: SYSTEM_ACTOR_ID,
      systemActorKey: SYSTEM_ACTOR_KEY,
    }
    await recoverContextBootstrapClaim({
      access: systemAccess,
      claim: winningClaim,
      database: requireDatabase(),
    })
    await recoverContextBootstrapClaim({
      access: systemAccess,
      claim: winningClaim,
      database: requireDatabase(),
    })

    const [recoveredBrand] = await requireDatabase()
      .select({ onboardingStatus: brands.onboardingStatus })
      .from(brands)
      .where(eq(brands.id, fixture.brandId))
      .limit(1)
    expect(recoveredBrand).toEqual({ onboardingStatus: 'incomplete' })
    await expect(
      getBrandImportStatus({
        access: fixture.access,
        database: requireDatabase(),
      })
    ).resolves.toEqual({
      currentBrandContextObjectId: null,
      kind: 'incomplete',
      retryAvailable: true,
    })
    const retryClaim = await operation()
    expect(retryClaim).toMatchObject({
      brandId: fixture.brandId,
      kind: 'claimed',
      websiteUrl: fixture.websiteUrl,
    })
    if (retryClaim.kind !== 'claimed') {
      throw new Error('The recovered Context import did not allow a new claim')
    }
    await recoverContextBootstrapClaim({
      access: systemAccess,
      claim: retryClaim,
      database: requireDatabase(),
    })
  })

  it('returns one Context bootstrap receipt instead of a stale singleton head', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createBrandFixture()
    const claim = await claimContextBootstrap({
      access: fixture.access,
      database: requireDatabase(),
    })
    if (claim.kind !== 'claimed') {
      throw new Error('The Context bootstrap setup replayed unexpectedly')
    }
    const input = {
      artifacts: [
        {
          blobKey: `brands/${fixture.brandId}/artifacts/sha256/${ARTIFACT_SHA}.png`,
          byteSize: 128,
          contentType: 'image/png' as const,
          finalUrl: 'https://assets.example.test/final-logo.png',
          sha256: ARTIFACT_SHA,
          sourceUrl: 'https://assets.example.test/source-logo.png',
        },
      ],
      snapshot: { name: 'Concurrent context' },
      websiteUrl: fixture.websiteUrl,
    }
    const operation = () =>
      commitContextBootstrap({
        access: {
          brandId: fixture.brandId,
          systemActorId: SYSTEM_ACTOR_ID,
          systemActorKey: SYSTEM_ACTOR_KEY,
        },
        claim,
        database: requireDatabase(),
        input,
      })

    const firstCommit = operation()
    await new Promise((resolve) => setTimeout(resolve, 25))
    const [first, second, concurrentReplay] = await Promise.all([
      firstCommit,
      operation(),
      claimContextBootstrap({
        access: fixture.access,
        database: requireDatabase(),
      }),
    ])

    expect(second).toEqual(first)
    expect(concurrentReplay).toEqual({ kind: 'replay', receipt: first })
    expect(
      await countActions({
        brandId: fixture.brandId,
        type: 'context_bootstrapped',
      })
    ).toBe(1)
    expect(await countObjects(fixture.brandId)).toBe(2)
    await expect(
      claimContextBootstrap({
        access: fixture.access,
        database: requireDatabase(),
      })
    ).resolves.toEqual({ kind: 'replay', receipt: first })

    await requireDatabase()
      .update(member)
      .set({ role: 'viewer' })
      .where(
        and(
          eq(member.organizationId, fixture.access.organizationId),
          eq(member.userId, fixture.access.userId)
        )
      )
    await expect(
      claimContextBootstrap({
        access: { ...fixture.access, role: 'viewer' },
        database: requireDatabase(),
      })
    ).resolves.toEqual({ kind: 'replay', receipt: first })
  })

  it('fences a stale Context import owner after claim takeover', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createBrandFixture()
    const firstClaim = await claimContextBootstrap({
      access: fixture.access,
      database: requireDatabase(),
    })
    if (firstClaim.kind !== 'claimed') {
      throw new Error('The stale claim setup replayed unexpectedly')
    }
    const staleClaimedAt = new Date(
      Date.now() - CONTEXT_BOOTSTRAP_CLAIM_STALE_AFTER_MS - 1000
    )
    await requireDatabase()
      .update(brands)
      .set({ updatedAt: staleClaimedAt })
      .where(eq(brands.id, fixture.brandId))
    const staleClaim = { ...firstClaim, claimedAt: staleClaimedAt }
    await expect(
      getBrandImportStatus({
        access: fixture.access,
        database: requireDatabase(),
        now: new Date(
          staleClaimedAt.getTime() + CONTEXT_BOOTSTRAP_CLAIM_STALE_AFTER_MS
        ),
      })
    ).resolves.toEqual({
      currentBrandContextObjectId: null,
      kind: 'importing',
      retryAvailable: true,
    })

    const replacementClaim = await claimContextBootstrap({
      access: fixture.access,
      database: requireDatabase(),
    })
    if (replacementClaim.kind !== 'claimed') {
      throw new Error('The stale Context import was not reclaimable')
    }
    expect(replacementClaim.claimedAt.getTime()).toBeGreaterThan(
      staleClaim.claimedAt.getTime()
    )
    await expect(
      getBrandImportStatus({
        access: fixture.access,
        database: requireDatabase(),
        now: replacementClaim.claimedAt,
      })
    ).resolves.toEqual({
      currentBrandContextObjectId: null,
      kind: 'importing',
      retryAvailable: false,
    })
    const systemAccess = {
      brandId: fixture.brandId,
      systemActorId: SYSTEM_ACTOR_ID,
      systemActorKey: SYSTEM_ACTOR_KEY,
    }

    await recoverContextBootstrapClaim({
      access: systemAccess,
      claim: staleClaim,
      database: requireDatabase(),
    })
    const [stillClaimed] = await requireDatabase()
      .select({
        onboardingStatus: brands.onboardingStatus,
        updatedAt: brands.updatedAt,
      })
      .from(brands)
      .where(eq(brands.id, fixture.brandId))
      .limit(1)
    expect(stillClaimed).toEqual({
      onboardingStatus: 'importing',
      updatedAt: replacementClaim.claimedAt,
    })

    await expect(
      commitContextBootstrap({
        access: systemAccess,
        claim: staleClaim,
        database: requireDatabase(),
        input: {
          artifacts: [
            {
              blobKey: `brands/${fixture.brandId}/artifacts/sha256/${ARTIFACT_SHA}.png`,
              byteSize: 128,
              contentType: 'image/png',
              finalUrl: 'https://assets.example.test/final-logo.png',
              sha256: ARTIFACT_SHA,
              sourceUrl: 'https://assets.example.test/source-logo.png',
            },
          ],
          snapshot: { name: 'Stale Context import' },
          websiteUrl: fixture.websiteUrl,
        },
      })
    ).rejects.toMatchObject({ code: 'already_claimed' })
    expect(
      await countActions({
        brandId: fixture.brandId,
        type: 'context_bootstrapped',
      })
    ).toBe(0)
    expect(await countObjects(fixture.brandId)).toBe(0)

    await recoverContextBootstrapClaim({
      access: systemAccess,
      claim: replacementClaim,
      database: requireDatabase(),
    })
  })

  it('returns one Intent refinement receipt instead of stale_intent', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createBrandFixture()
    const input = {
      acceptanceCriteria: [{ metric: 'qualified pipeline' }],
      constraints: null,
      expectedRevision: 1,
      intentId: fixture.intentId,
      requestId: `refine:${randomUUID()}`,
    }
    const operation = () =>
      refineIntent({
        access: fixture.access,
        database: requireDatabase(),
        input,
      })

    const [first, second] = await Promise.all([operation(), operation()])

    expect(second).toEqual(first)
    expect(first.intentRevision).toBe(2)
    expect(
      await countActions({
        brandId: fixture.brandId,
        type: 'intent_refined',
      })
    ).toBe(1)
  })

  it('rejects divergent hashes before observing a later Intent revision', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createBrandFixture()
    const requestId = `refine:${randomUUID()}`
    const operation = (metric: string) =>
      refineIntent({
        access: fixture.access,
        database: requireDatabase(),
        input: {
          acceptanceCriteria: [{ metric }],
          constraints: null,
          expectedRevision: 1,
          intentId: fixture.intentId,
          requestId,
        },
      })

    const results = await Promise.allSettled([
      operation('qualified pipeline'),
      operation('retained revenue'),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.find((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status !== 'rejected') {
      throw new Error('The divergent receipt race unexpectedly succeeded')
    }
    requireOperationConflict(rejected.reason)
    expect(
      await countActions({
        brandId: fixture.brandId,
        type: 'intent_refined',
      })
    ).toBe(1)
  })

  it('returns the created task receipt instead of an accidental active-task observation', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createBrandFixture()
    const conversation = await createCmoConversation({
      access: fixture.access,
      database: requireDatabase(),
      input: { title: 'Concurrent specialist request' },
    })
    const sessionId = `session:${randomUUID()}`
    await bindCmoSession({
      access: fixture.access,
      database: requireDatabase(),
      input: {
        conversationId: conversation.id,
        sessionId,
        source: 'proxy-create-response',
      },
    })
    const turnAccess: TrustedCmoTurnAccess = {
      ...fixture.access,
      callId: `call:${randomUUID()}`,
      cmoActorId: CMO_ACTOR_ID,
      cmoActorKey: CMO_ACTOR_KEY,
      conversationId: conversation.id,
      rootSessionId: sessionId,
      sessionId,
      turnId: `turn:${randomUUID()}`,
    }
    const input = {
      intentId: fixture.intentId,
      kind: PRODUCT_MARKETER_TASK_KIND,
      payload: { purpose: 'enrich_brand_context' as const },
      requestId: `specialist:${randomUUID()}`,
    }
    const operation = () =>
      requestSpecialistWork({
        access: turnAccess,
        database: requireDatabase(),
        input,
      })

    const [first, second] = await Promise.all([operation(), operation()])

    expect(first.disposition).toBe('created')
    expect(second).toEqual(first)
    expect(await countTasks(fixture.brandId)).toBe(1)
    expect(
      await countActions({
        brandId: fixture.brandId,
        type: 'specialist_work_requested',
      })
    ).toBe(1)
  })

  it.each([
    {
      disposition: 'answered' as const,
      rationale: 'The human answered the complete immutable bundle.',
    },
    {
      disposition: 'no_longer_relevant' as const,
      rationale: 'The human confirmed that the bundle is obsolete.',
    },
  ])(
    'returns one $disposition receipt for concurrent request ids',
    {
      timeout: TEST_TIMEOUT_MS,
    },
    async (resolution) => {
      const fixture = await createBrandFixture()
      const question = 'Which segment is the first priority?'
      const source = await createOpenQuestionTask({ fixture, question })
      const operation = (requestId: string, callId: string) =>
        resolveTaskQuestions({
          access: { ...source.access, callId },
          database: requireDatabase(),
          input: {
            ...resolution,
            requestId,
            taskId: source.taskId,
          },
        })

      const [first, second] = await Promise.all([
        operation(`questions:first:${randomUUID()}`, `call:${randomUUID()}`),
        operation(`questions:second:${randomUUID()}`, `call:${randomUUID()}`),
      ])

      expect(second).toEqual(first)
      expect(first).toMatchObject(resolution)
      expect(first).not.toHaveProperty('answers')
      await requireDatabase()
        .update(member)
        .set({ role: 'viewer' })
        .where(
          and(
            eq(member.organizationId, fixture.access.organizationId),
            eq(member.userId, fixture.access.userId)
          )
        )
      await expect(
        resolveTaskQuestions({
          access: {
            ...source.access,
            callId: `call:${randomUUID()}`,
            role: 'viewer',
          },
          database: requireDatabase(),
          input: {
            ...resolution,
            requestId: `questions:viewer-replay:${randomUUID()}`,
            taskId: source.taskId,
          },
        })
      ).resolves.toEqual(first)
      const otherDisposition =
        resolution.disposition === 'answered'
          ? ('no_longer_relevant' as const)
          : ('answered' as const)
      await expect(
        resolveTaskQuestions({
          access: source.access,
          database: requireDatabase(),
          input: {
            disposition: otherDisposition,
            rationale: resolution.rationale,
            requestId: `questions:different-disposition:${randomUUID()}`,
            taskId: source.taskId,
          },
        })
      ).rejects.toMatchObject({ code: 'operation_conflict' })
      await expect(
        resolveTaskQuestions({
          access: source.access,
          database: requireDatabase(),
          input: {
            disposition: resolution.disposition,
            rationale: `${resolution.rationale} Different semantic judgment.`,
            requestId: `questions:different-rationale:${randomUUID()}`,
            taskId: source.taskId,
          },
        })
      ).rejects.toMatchObject({ code: 'operation_conflict' })
      await expect(
        resolveTaskQuestions({
          access: {
            ...source.access,
            callId: `call:${randomUUID()}`,
            role: 'viewer',
            turnId: `turn:${randomUUID()}`,
          },
          database: requireDatabase(),
          input: {
            ...resolution,
            requestId: `questions:different-turn:${randomUUID()}`,
            taskId: source.taskId,
          },
        })
      ).rejects.toMatchObject({ code: 'operation_conflict' })
      const secondMember = await createAdditionalBrandMember(fixture)
      const secondMemberTurn = await createBoundCmoTurnAccess({
        access: secondMember,
        title: 'Second member question resolution',
      })
      await expect(
        resolveTaskQuestions({
          access: secondMemberTurn,
          database: requireDatabase(),
          input: {
            ...resolution,
            requestId: `questions:different-human:${randomUUID()}`,
            taskId: source.taskId,
          },
        })
      ).rejects.toMatchObject({ code: 'operation_conflict' })
      expect(
        await countActions({
          brandId: fixture.brandId,
          type: 'task_questions_resolved',
        })
      ).toBe(1)
      expect(await countTasks(fixture.brandId)).toBe(1)
    }
  )

  it('rejects divergent concurrent question resolutions through the canonical receipt', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createBrandFixture()
    const question = 'Which segment is the first priority?'
    const source = await createOpenQuestionTask({ fixture, question })

    const results = await Promise.allSettled([
      resolveTaskQuestions({
        access: source.access,
        database: requireDatabase(),
        input: {
          disposition: 'answered',
          rationale: 'The human closed the complete immutable bundle.',
          requestId: `questions:first:${randomUUID()}`,
          taskId: source.taskId,
        },
      }),
      resolveTaskQuestions({
        access: source.access,
        database: requireDatabase(),
        input: {
          disposition: 'no_longer_relevant',
          rationale: 'The human closed the complete immutable bundle.',
          requestId: `questions:second:${randomUUID()}`,
          taskId: source.taskId,
        },
      }),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.find((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status !== 'rejected') {
      throw new Error('The divergent question-resolution race succeeded')
    }
    requireOperationConflict(rejected.reason)
    expect(
      await countActions({
        brandId: fixture.brandId,
        type: 'task_questions_resolved',
      })
    ).toBe(1)
  })
})
