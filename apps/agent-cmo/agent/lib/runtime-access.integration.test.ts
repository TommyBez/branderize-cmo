import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  PRODUCT_MARKETER_TASK_KIND,
  PRODUCT_MARKETER_WORKER_KEY,
} from '@repo/agents/tasks'
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
  cmoConversations,
  intents,
  tasks,
} from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'
import type { ToolContext } from 'eve/tools'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import refineIntentTool from '../tools/refine_intent'
import resolveProductMarketerQuestionsTool from '../tools/resolve_product_marketer_questions'
import {
  loadCmoIntentTarget,
  resolveTrustedCmoTurnAccess,
} from './runtime-access'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const TEST_TIMEOUT_MS = 30_000
const CMO_ACTOR_ID = '00000000-0000-0000-0000-000000000101'
const schemaName = `cmo_runtime_access_${randomUUID().replaceAll('-', '_')}`

interface IntentFixture {
  readonly brandId: string
  readonly conversationId: string
  readonly firstIntentId: string
  readonly humanActorId: string
  readonly secondIntentId: string
  readonly sessionId: string
  readonly userId: string
}

interface CmoActionInput {
  readonly fixture: IntentFixture
  readonly intentId: string
  readonly sessionId?: string
  readonly turnId: string
}

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The CMO runtime access database is unavailable')
  }
  return database
}

vi.mock('@repo/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@repo/db')>()
  return {
    ...original,
    get db() {
      return requireDatabase()
    },
  }
})

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  Symbol.asyncIterator in value &&
  typeof value[Symbol.asyncIterator] === 'function'

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

const createIntentFixture = async (): Promise<IntentFixture> => {
  const unique = randomUUID()
  const brandId = randomUUID()
  const conversationId = randomUUID()
  const firstIntentId = randomUUID()
  const humanActorId = randomUUID()
  const organizationId = `organization:${unique}`
  const secondIntentId = randomUUID()
  const sessionId = `session:${unique}`
  const userId = `user:${unique}`
  const currentDatabase = requireDatabase()

  await currentDatabase.insert(user).values({
    email: `${unique}@example.test`,
    id: userId,
    name: 'CMO runtime owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'CMO runtime organization',
    slug: `cmo-runtime-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role: 'owner',
    userId,
  })
  await currentDatabase.insert(brands).values({
    id: brandId,
    name: 'CMO runtime brand',
    organizationId,
    slug: `cmo-runtime-${unique}`,
    websiteUrl: `https://${unique}.example.test`,
  })
  await currentDatabase.insert(actors).values({
    actorKey: `human:${userId}`,
    id: humanActorId,
    type: 'human',
    userId,
  })
  await currentDatabase.insert(cmoConversations).values({
    brandId,
    id: conversationId,
    ownerUserId: userId,
    sessionId,
    title: 'CMO runtime replay',
  })
  await currentDatabase.insert(intents).values([
    {
      authorActorId: humanActorId,
      brandId,
      id: firstIntentId,
      parentIntentId: null,
      revision: 1,
      statement: 'Keep the existing objective active.',
      status: 'active',
    },
    {
      authorActorId: humanActorId,
      brandId,
      id: secondIntentId,
      parentIntentId: null,
      revision: 1,
      statement: 'Add a second root objective through the CMO.',
      status: 'active',
    },
  ])

  return {
    brandId,
    conversationId,
    firstIntentId,
    humanActorId,
    secondIntentId,
    sessionId,
    userId,
  }
}

const toolContext = ({
  callId,
  fixture,
  sourceTaskId,
  toolName,
  turnId,
}: {
  readonly callId: string
  readonly fixture: IntentFixture
  readonly sourceTaskId?: string
  readonly toolName: string
  readonly turnId: string
}): ToolContext => {
  const initiator = {
    attributes: {
      brand_id: fixture.brandId,
      conversation_id: fixture.conversationId,
    },
    authenticator: 'cmo-bridge',
    issuer: 'branderize-app',
    principalId: fixture.userId,
    principalType: 'user' as const,
    subject: fixture.userId,
  }
  const current = {
    ...initiator,
    attributes: {
      ...initiator.attributes,
      ...(sourceTaskId === undefined ? {} : { source_task_id: sourceTaskId }),
    },
  }

  return {
    abortSignal: new AbortController().signal,
    callId,
    getSandbox: () => {
      throw new Error('The integration tool does not use a sandbox')
    },
    getSkill: () => {
      throw new Error('The integration tool does not load a skill')
    },
    getToken: () => {
      throw new Error('The integration tool does not request a token')
    },
    requireAuth: () => {
      throw new Error('The integration tool does not request authorization')
    },
    session: {
      auth: { current, initiator },
      id: fixture.sessionId,
      turn: { id: turnId, sequence: 0 },
    },
    toolName,
  }
}

const createOpenQuestionTask = async ({
  fixture,
}: {
  readonly fixture: IntentFixture
}): Promise<string> => {
  const taskId = randomUUID()
  await requireDatabase()
    .insert(tasks)
    .values({
      activation: 'automatic',
      brandId: fixture.brandId,
      completion: {
        intentAcceptance: null,
        openQuestions: ['Which segment is the first priority?'],
        outputObjectIds: [],
        result: {
          outcome: 'needs_input',
          reason: 'missing_human_context',
        },
        status: 'blocked',
        summary: 'The Product Marketer needs one explicit human answer.',
      },
      executionMode: 'agent',
      finishedAt: new Date(),
      id: taskId,
      intentId: fixture.secondIntentId,
      intentSnapshot: {
        acceptance_criteria: null,
        brand_id: fixture.brandId,
        constraints: null,
        intent_id: fixture.secondIntentId,
        intent_revision: 1,
        preauthorizations: [],
        statement: 'Add a second root objective through the CMO.',
      },
      kind: PRODUCT_MARKETER_TASK_KIND,
      outcomeCode: 'blocked',
      payload: { purpose: 'enrich_brand_context' },
      payloadHash: 'open-question-task',
      status: 'succeeded',
      subjectKey: `${PRODUCT_MARKETER_WORKER_KEY}:brand-context`,
      workerKey: PRODUCT_MARKETER_WORKER_KEY,
    })
  return taskId
}

const insertCmoIntentAction = async ({
  fixture,
  intentId,
  sessionId = fixture.sessionId,
  turnId,
}: CmoActionInput): Promise<void> => {
  const actionId = randomUUID()
  await requireDatabase()
    .insert(actions)
    .values({
      actorId: CMO_ACTOR_ID,
      brandId: fixture.brandId,
      callId: `call:${actionId}`,
      conversationId: fixture.conversationId,
      effectClass: 'graph-internal',
      id: actionId,
      intentId,
      payload: {
        actionId,
        intentId,
        intentRevision: 1,
        outcome: 'intent_declared',
        producerContext: {
          authorizingHumanActorId: fixture.humanActorId,
          callId: `call:${actionId}`,
          conversationId: fixture.conversationId,
          kind: 'cmo-interactive',
          sessionId,
          turnId,
        },
      },
      policySnapshot: {},
      rationale: 'Test trusted CMO Intent provenance',
      sessionId,
      turnId,
      type: 'intent_declared',
    })
}

const trustedTurnAccess = async ({
  fixture,
  turnId,
}: {
  readonly fixture: IntentFixture
  readonly turnId: string
}) =>
  await resolveTrustedCmoTurnAccess({
    context: toolContext({
      callId: `call:${randomUUID()}`,
      fixture,
      toolName: 'test_runtime_access',
      turnId,
    }),
    database: requireDatabase(),
  })

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for CMO integration tests')
  }

  adminPool = createDatabasePool({ connectionString: databaseUrl, max: 1 })
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`)

  const scopedUrl = new URL(databaseUrl)
  scopedUrl.searchParams.set('options', `-c search_path=${schemaName},public`)
  databasePool = createDatabasePool({
    connectionString: scopedUrl.toString(),
    max: 4,
  })
  database = createDatabase(databasePool)

  const migration = await readFile(
    new URL(
      '../../../../packages/db/drizzle/0000_phase0_foundation.sql',
      import.meta.url
    ),
    'utf8'
  )
  const statements = migration
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
  await applyMigrationStatements({ pool: databasePool, statements })
})

afterAll(async () => {
  await databasePool?.end()
  if (adminPool !== undefined) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await adminPool.end()
  }
})

describe('CMO Intent continuity on PostgreSQL', () => {
  it('keeps the second root Intent on the following conversation turn', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createIntentFixture()
    await insertCmoIntentAction({
      fixture,
      intentId: fixture.secondIntentId,
      turnId: 'turn-2',
    })

    await expect(
      loadCmoIntentTarget({
        access: await trustedTurnAccess({ fixture, turnId: 'turn-2' }),
        database: requireDatabase(),
      })
    ).resolves.toEqual({ id: fixture.secondIntentId, revision: 1 })
    await expect(
      loadCmoIntentTarget({
        access: await trustedTurnAccess({ fixture, turnId: 'turn-3' }),
        database: requireDatabase(),
      })
    ).resolves.toEqual({ id: fixture.secondIntentId, revision: 1 })
  })

  it('fails closed when one conversation produced two active Intents', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createIntentFixture()
    await insertCmoIntentAction({
      fixture,
      intentId: fixture.firstIntentId,
      turnId: 'turn-1',
    })
    await insertCmoIntentAction({
      fixture,
      intentId: fixture.secondIntentId,
      turnId: 'turn-2',
    })

    await expect(
      loadCmoIntentTarget({
        access: await trustedTurnAccess({ fixture, turnId: 'turn-3' }),
        database: requireDatabase(),
      })
    ).rejects.toThrow(
      'The current CMO conversation identifies ambiguous active Intents'
    )
  })

  it('reads the current revision and drops inactive historical provenance', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createIntentFixture()
    await insertCmoIntentAction({
      fixture,
      intentId: fixture.secondIntentId,
      turnId: 'turn-2',
    })
    await requireDatabase()
      .update(intents)
      .set({ revision: 2 })
      .where(eq(intents.id, fixture.secondIntentId))

    await expect(
      loadCmoIntentTarget({
        access: await trustedTurnAccess({ fixture, turnId: 'turn-3' }),
        database: requireDatabase(),
      })
    ).resolves.toEqual({ id: fixture.secondIntentId, revision: 2 })

    await requireDatabase()
      .update(intents)
      .set({ revision: 3, status: 'settled' })
      .where(eq(intents.id, fixture.secondIntentId))

    await expect(
      loadCmoIntentTarget({
        access: await trustedTurnAccess({ fixture, turnId: 'turn-4' }),
        database: requireDatabase(),
      })
    ).resolves.toEqual({ id: fixture.firstIntentId, revision: 1 })
  })

  it('does not fall through when the current turn points to an inactive Intent', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createIntentFixture()
    await insertCmoIntentAction({
      fixture,
      intentId: fixture.secondIntentId,
      turnId: 'turn-2',
    })
    await requireDatabase()
      .update(intents)
      .set({ revision: 2, status: 'settled' })
      .where(eq(intents.id, fixture.secondIntentId))

    await expect(
      loadCmoIntentTarget({
        access: await trustedTurnAccess({ fixture, turnId: 'turn-2' }),
        database: requireDatabase(),
      })
    ).rejects.toThrow('The current CMO turn targets no active Intent')
  })
})

describe('CMO canonical tool replay on PostgreSQL', () => {
  it('replays a completed Intent refinement without advancing the revision again', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createIntentFixture()
    const turnId = `turn:${randomUUID()}`
    await insertCmoIntentAction({
      fixture,
      intentId: fixture.secondIntentId,
      turnId,
    })
    const input = {
      acceptanceCriteria: [{ metric: 'qualified pipeline' }],
      constraints: null,
    }

    const first = await refineIntentTool.execute(
      input,
      toolContext({
        callId: `call:${randomUUID()}`,
        fixture,
        toolName: 'refine_intent',
        turnId,
      })
    )
    const replay = await refineIntentTool.execute(
      input,
      toolContext({
        callId: `call:${randomUUID()}`,
        fixture,
        toolName: 'refine_intent',
        turnId,
      })
    )
    if (isAsyncIterable(first) || isAsyncIterable(replay)) {
      throw new Error('The Intent refinement tool unexpectedly streamed')
    }

    expect(replay).toEqual(first)
    expect(first.intentRevision).toBe(2)
    await expect(
      requireDatabase()
        .select({ revision: intents.revision })
        .from(intents)
        .where(eq(intents.id, fixture.secondIntentId))
        .limit(1)
    ).resolves.toEqual([{ revision: 2 }])
    await expect(
      requireDatabase()
        .select({ id: actions.id })
        .from(actions)
        .where(
          and(
            eq(actions.brandId, fixture.brandId),
            eq(actions.type, 'intent_refined')
          )
        )
    ).resolves.toHaveLength(1)
  })

  it('replays a completed Product Marketer question resolution after the bundle closes', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const fixture = await createIntentFixture()
    const taskId = await createOpenQuestionTask({ fixture })
    const turnId = `turn:${randomUUID()}`
    const input = {
      disposition: 'answered' as const,
      rationale: 'The human answered the complete immutable bundle.',
    }

    const first = await resolveProductMarketerQuestionsTool.execute(
      input,
      toolContext({
        callId: `call:${randomUUID()}`,
        fixture,
        sourceTaskId: taskId,
        toolName: 'resolve_product_marketer_questions',
        turnId,
      })
    )
    const replay = await resolveProductMarketerQuestionsTool.execute(
      input,
      toolContext({
        callId: `call:${randomUUID()}`,
        fixture,
        sourceTaskId: taskId,
        toolName: 'resolve_product_marketer_questions',
        turnId,
      })
    )
    if (isAsyncIterable(first) || isAsyncIterable(replay)) {
      throw new Error(
        'The Product Marketer question resolution tool unexpectedly streamed'
      )
    }

    expect(replay).toEqual(first)
    await expect(
      requireDatabase()
        .select({ id: actions.id })
        .from(actions)
        .where(
          and(
            eq(actions.brandId, fixture.brandId),
            eq(actions.type, 'task_questions_resolved')
          )
        )
    ).resolves.toHaveLength(1)
  })
})
