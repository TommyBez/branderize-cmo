import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { PRODUCT_MARKETER_TASK_KIND } from '@repo/agents/tasks'
import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { member, organization, user } from '@repo/db/schema/auth'
import { actions, actors, brands, intents, tasks } from '@repo/db/schema/domain'
import { executeStatementsSequentially } from '@repo/db/test-support'
import { and, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadCmoIntentTarget } from './cmo-intent-target'
import type { TrustedCmoTurnAccess, TrustedMemberAccess } from './context'
import { bindCmoSession, createCmoConversation } from './conversations'
import { BrainError } from './errors'
import {
  abandonIntent,
  adoptIntent,
  declareIntent,
  proposeIntentFromCmo,
} from './intents'
import { requestSpecialistWork } from './task-request'

const CMO_ACTOR_ID = '00000000-0000-0000-0000-000000000101'
const CMO_ACTOR_KEY = 'agent:cmo' as const
const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const TEST_TIMEOUT_MS = 30_000
const CONCURRENT_ADOPT_FAILURE = /^(?:intent_not_draft|stale_intent)$/u
const schemaName = `brain_draft_intents_${randomUUID().replaceAll('-', '_')}`

interface CmoFixture {
  readonly brandId: string
  readonly conversationId: string
  readonly memberAccess: TrustedMemberAccess
  readonly sessionId: string
  readonly turnAccess: (input: {
    readonly callId: string
    readonly turnId: string
  }) => TrustedCmoTurnAccess
}

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The draft Intent integration database is unavailable')
  }
  return database
}

const createCmoFixture = async (): Promise<CmoFixture> => {
  const unique = randomUUID()
  const brandId = randomUUID()
  const humanActorId = randomUUID()
  const organizationId = `organization:${unique}`
  const userId = `user:${unique}`
  const currentDatabase = requireDatabase()

  await currentDatabase.insert(user).values({
    email: `${unique}@example.test`,
    id: userId,
    name: 'Draft Intent owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'Draft Intent organization',
    slug: `draft-intent-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role: 'owner',
    userId,
  })
  await currentDatabase.insert(brands).values({
    id: brandId,
    name: 'Draft Intent brand',
    organizationId,
    slug: `draft-intent-${unique}`,
    websiteUrl: `https://${unique}.example.test`,
  })
  await currentDatabase.insert(actors).values({
    actorKey: `human:${userId}`,
    id: humanActorId,
    type: 'human',
    userId,
  })

  const memberAccess: TrustedMemberAccess = {
    brandId,
    humanActorId,
    humanActorKey: `human:${userId}`,
    organizationId,
    role: 'owner',
    userId,
  }
  const conversation = await createCmoConversation({
    access: memberAccess,
    database: currentDatabase,
    input: { title: 'Draft Intent proposals' },
  })
  const sessionId = `session:${unique}`
  await bindCmoSession({
    access: memberAccess,
    database: currentDatabase,
    input: {
      conversationId: conversation.id,
      sessionId,
      source: 'proxy-create-response',
    },
  })

  return {
    brandId,
    conversationId: conversation.id,
    memberAccess,
    sessionId,
    turnAccess: ({ callId, turnId }) => ({
      ...memberAccess,
      callId,
      cmoActorId: CMO_ACTOR_ID,
      cmoActorKey: CMO_ACTOR_KEY,
      conversationId: conversation.id,
      rootSessionId: sessionId,
      sessionId,
      turnId,
    }),
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
    throw new Error('The draft Intent action count query returned no row')
  }
  return result.total
}

const readIntentRow = async (intentId: string) => {
  const [intent] = await requireDatabase()
    .select({
      authorActorId: intents.authorActorId,
      parentIntentId: intents.parentIntentId,
      revision: intents.revision,
      status: intents.status,
    })
    .from(intents)
    .where(eq(intents.id, intentId))
    .limit(1)
  if (intent === undefined) {
    throw new Error('The draft Intent row was not found')
  }
  return intent
}

const proposeDraft = async (
  fixture: CmoFixture,
  requestId = `propose:${randomUUID()}`
) => {
  const access = fixture.turnAccess({
    callId: `call:${randomUUID()}`,
    turnId: `turn:${randomUUID()}`,
  })
  const input = {
    acceptanceCriteria: [{ metric: 'a named primary audience' }],
    constraints: null,
    requestId,
    statement: 'Propose one specific launch audience.',
  }
  return {
    access,
    input,
    receipt: await proposeIntentFromCmo({
      access,
      database: requireDatabase(),
      input,
    }),
  }
}

const expectClosedFailure = async ({
  actionType,
  brandId,
  code,
  operation,
}: {
  readonly actionType: string
  readonly brandId: string
  readonly code: BrainError['code']
  readonly operation: () => Promise<unknown>
}): Promise<void> => {
  const before = await countActions({ brandId, type: actionType })
  await expect(operation()).rejects.toMatchObject({
    code,
  } satisfies Partial<BrainError>)
  expect(await countActions({ brandId, type: actionType })).toBe(before)
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for draft Intent tests')
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
    new URL('../../db/drizzle/0000_phase0_foundation.sql', import.meta.url),
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
})

afterAll(async () => {
  await databasePool?.end()
  if (adminPool !== undefined) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await adminPool.end()
  }
})

describe('draft Intent proposals on PostgreSQL', () => {
  it('inserts one CMO-authored draft and replays the same request', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createCmoFixture()
    const requestId = `propose:${randomUUID()}`
    const first = await proposeDraft(fixture, requestId)
    const row = await readIntentRow(first.receipt.intentId)

    expect(first.receipt).toMatchObject({
      intentRevision: 1,
      outcome: 'intent_proposed',
      producerContext: {
        authorizingHumanActorId: fixture.memberAccess.humanActorId,
        kind: 'cmo-interactive',
      },
    })
    expect(row).toEqual({
      authorActorId: CMO_ACTOR_ID,
      parentIntentId: null,
      revision: 1,
      status: 'draft',
    })
    expect(
      await countActions({ brandId: fixture.brandId, type: 'intent_proposed' })
    ).toBe(1)

    await expect(
      proposeIntentFromCmo({
        access: first.access,
        database: requireDatabase(),
        input: first.input,
      })
    ).resolves.toEqual(first.receipt)
    expect(
      await countActions({ brandId: fixture.brandId, type: 'intent_proposed' })
    ).toBe(1)

    const [intentCount] = await requireDatabase()
      .select({ total: count() })
      .from(intents)
      .where(eq(intents.brandId, fixture.brandId))
    expect(intentCount?.total).toBe(1)
  })

  it('rejects a different hash on the same propose operation key', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createCmoFixture()
    const requestId = `propose:${randomUUID()}`
    const first = await proposeDraft(fixture, requestId)

    await expect(
      proposeIntentFromCmo({
        access: first.access,
        database: requireDatabase(),
        input: {
          ...first.input,
          statement: 'A different proposed objective.',
        },
      })
    ).rejects.toMatchObject({
      code: 'operation_conflict',
    } satisfies Partial<BrainError>)
    expect(
      await countActions({ brandId: fixture.brandId, type: 'intent_proposed' })
    ).toBe(1)
  })

  it('keeps specialist work and the CMO target on the active Intent', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createCmoFixture()
    const declared = await declareIntent({
      access: fixture.memberAccess,
      database: requireDatabase(),
      input: {
        acceptanceCriteria: null,
        constraints: null,
        requestId: `declare:${randomUUID()}`,
        statement: 'Keep the live objective explicit.',
      },
    })
    const proposed = await proposeDraft(fixture)

    await expect(
      requestSpecialistWork({
        access: fixture.turnAccess({
          callId: `call:${randomUUID()}`,
          turnId: `turn:${randomUUID()}`,
        }),
        database: requireDatabase(),
        input: {
          intentId: proposed.receipt.intentId,
          kind: PRODUCT_MARKETER_TASK_KIND,
          payload: { purpose: 'enrich_brand_context' },
          requestId: `specialist:${randomUUID()}`,
        },
      })
    ).rejects.toMatchObject({
      code: 'intent_not_active',
    } satisfies Partial<BrainError>)
    await expect(
      loadCmoIntentTarget({
        access: proposed.access,
        database: requireDatabase(),
      })
    ).resolves.toEqual({ id: declared.intentId, revision: 1 })
  })

  it('adopts a draft as active revision 2 with the human Action actor', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createCmoFixture()
    const proposed = await proposeDraft(fixture)
    const adopted = await adoptIntent({
      access: fixture.memberAccess,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        intentId: proposed.receipt.intentId,
        requestId: `adopt:${randomUUID()}`,
      },
    })
    const row = await readIntentRow(proposed.receipt.intentId)
    const [action] = await requireDatabase()
      .select({ actorId: actions.actorId, type: actions.type })
      .from(actions)
      .where(eq(actions.id, adopted.actionId))
      .limit(1)

    expect(adopted).toMatchObject({
      after: { revision: 2, status: 'active' },
      before: { revision: 1, status: 'draft' },
      intentId: proposed.receipt.intentId,
      intentRevision: 2,
      outcome: 'intent_adopted',
      producerContext: {
        authorizingHumanActorId: fixture.memberAccess.humanActorId,
        kind: 'human-direct',
      },
    })
    expect(row).toEqual({
      authorActorId: CMO_ACTOR_ID,
      parentIntentId: null,
      revision: 2,
      status: 'active',
    })
    expect(action).toEqual({
      actorId: fixture.memberAccess.humanActorId,
      type: 'intent_adopted',
    })
  })

  it('fails adopt closed for active, stale, cross-tenant, and viewer callers', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createCmoFixture()
    const foreign = await createCmoFixture()
    const declared = await declareIntent({
      access: fixture.memberAccess,
      database: requireDatabase(),
      input: {
        acceptanceCriteria: null,
        constraints: null,
        requestId: `declare:${randomUUID()}`,
        statement: 'An already active objective.',
      },
    })
    const proposed = await proposeDraft(fixture)

    await expectClosedFailure({
      actionType: 'intent_adopted',
      brandId: fixture.brandId,
      code: 'intent_not_draft',
      operation: () =>
        adoptIntent({
          access: fixture.memberAccess,
          database: requireDatabase(),
          input: {
            expectedRevision: 1,
            intentId: declared.intentId,
            requestId: `adopt-active:${randomUUID()}`,
          },
        }),
    })
    await expectClosedFailure({
      actionType: 'intent_adopted',
      brandId: fixture.brandId,
      code: 'stale_intent',
      operation: () =>
        adoptIntent({
          access: fixture.memberAccess,
          database: requireDatabase(),
          input: {
            expectedRevision: 99,
            intentId: proposed.receipt.intentId,
            requestId: `adopt-stale:${randomUUID()}`,
          },
        }),
    })
    await expectClosedFailure({
      actionType: 'intent_adopted',
      brandId: foreign.brandId,
      code: 'intent_not_found',
      operation: () =>
        adoptIntent({
          access: foreign.memberAccess,
          database: requireDatabase(),
          input: {
            expectedRevision: 1,
            intentId: proposed.receipt.intentId,
            requestId: `adopt-cross:${randomUUID()}`,
          },
        }),
    })

    await requireDatabase()
      .update(member)
      .set({ role: 'viewer' })
      .where(
        and(
          eq(member.organizationId, fixture.memberAccess.organizationId),
          eq(member.userId, fixture.memberAccess.userId)
        )
      )
    await expectClosedFailure({
      actionType: 'intent_adopted',
      brandId: fixture.brandId,
      code: 'access_denied',
      operation: () =>
        adoptIntent({
          access: { ...fixture.memberAccess, role: 'viewer' },
          database: requireDatabase(),
          input: {
            expectedRevision: 1,
            intentId: proposed.receipt.intentId,
            requestId: `adopt-viewer:${randomUUID()}`,
          },
        }),
    })
    expect(await readIntentRow(proposed.receipt.intentId)).toMatchObject({
      revision: 1,
      status: 'draft',
    })
  })

  it('abandons both draft and active Intents without rewriting task snapshots', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createCmoFixture()
    const proposed = await proposeDraft(fixture)
    const abandonedDraft = await abandonIntent({
      access: fixture.memberAccess,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        intentId: proposed.receipt.intentId,
        rationale: 'The proposal is no longer useful.',
        requestId: `abandon-draft:${randomUUID()}`,
      },
    })
    expect(abandonedDraft).toMatchObject({
      after: { revision: 2, status: 'abandoned' },
      before: { revision: 1, status: 'draft' },
      outcome: 'intent_abandoned',
    })
    expect(await readIntentRow(proposed.receipt.intentId)).toMatchObject({
      authorActorId: CMO_ACTOR_ID,
      revision: 2,
      status: 'abandoned',
    })

    const declared = await declareIntent({
      access: fixture.memberAccess,
      database: requireDatabase(),
      input: {
        acceptanceCriteria: null,
        constraints: null,
        requestId: `declare:${randomUUID()}`,
        statement: 'Abandon an already active objective.',
      },
    })
    const requested = await requestSpecialistWork({
      access: fixture.turnAccess({
        callId: `call:${randomUUID()}`,
        turnId: `turn:${randomUUID()}`,
      }),
      database: requireDatabase(),
      input: {
        intentId: declared.intentId,
        kind: PRODUCT_MARKETER_TASK_KIND,
        payload: { purpose: 'enrich_brand_context' },
        requestId: `specialist:${randomUUID()}`,
      },
    })
    if (requested.disposition !== 'created') {
      throw new Error('The abandon fixture did not create a specialist task')
    }
    const [taskBefore] = await requireDatabase()
      .select({ intentSnapshot: tasks.intentSnapshot })
      .from(tasks)
      .where(eq(tasks.id, requested.taskId))
      .limit(1)

    const abandonedActive = await abandonIntent({
      access: fixture.memberAccess,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        intentId: declared.intentId,
        requestId: `abandon-active:${randomUUID()}`,
      },
    })
    const [taskAfter] = await requireDatabase()
      .select({ intentSnapshot: tasks.intentSnapshot })
      .from(tasks)
      .where(eq(tasks.id, requested.taskId))
      .limit(1)

    expect(abandonedActive).toMatchObject({
      after: { revision: 2, status: 'abandoned' },
      before: { revision: 1, status: 'active' },
      outcome: 'intent_abandoned',
    })
    expect(taskAfter?.intentSnapshot).toEqual(taskBefore?.intentSnapshot)
    expect(
      await countActions({ brandId: fixture.brandId, type: 'intent_abandoned' })
    ).toBe(2)
  })

  it('lets only one concurrent adopt win', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createCmoFixture()
    const proposed = await proposeDraft(fixture)
    const results = await Promise.allSettled([
      adoptIntent({
        access: fixture.memberAccess,
        database: requireDatabase(),
        input: {
          expectedRevision: 1,
          intentId: proposed.receipt.intentId,
          requestId: `adopt-race-a:${randomUUID()}`,
        },
      }),
      adoptIntent({
        access: fixture.memberAccess,
        database: requireDatabase(),
        input: {
          expectedRevision: 1,
          intentId: proposed.receipt.intentId,
          requestId: `adopt-race-b:${randomUUID()}`,
        },
      }),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.find((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(BrainError)
      expect(rejected.reason).toMatchObject({
        code: expect.stringMatching(CONCURRENT_ADOPT_FAILURE),
      })
    }
    expect(
      await countActions({ brandId: fixture.brandId, type: 'intent_adopted' })
    ).toBe(1)
    expect(await readIntentRow(proposed.receipt.intentId)).toMatchObject({
      authorActorId: CMO_ACTOR_ID,
      revision: 2,
      status: 'active',
    })
  })
})
