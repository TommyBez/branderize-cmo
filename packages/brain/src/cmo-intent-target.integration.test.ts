import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { PRODUCT_MARKETER_TASK_KIND } from '@repo/agents/tasks'
import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { member, organization, user } from '@repo/db/schema/auth'
import { actions, actors, brands, tasks } from '@repo/db/schema/domain'
import { executeStatementsSequentially } from '@repo/db/test-support'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  loadCmoIntentTarget,
  loadCmoRefineIntentTarget,
} from './cmo-intent-target'
import type { TrustedCmoTurnAccess, TrustedMemberAccess } from './context'
import { bindCmoSession, createCmoConversation } from './conversations'
import type { BrainError } from './errors'
import {
  declareIntent,
  declareIntentFromCmo,
  refineIntentFromCmo,
} from './intents'
import { resolveTaskQuestions } from './task-question-resolution'
import { requestSpecialistWork } from './task-request'

const CMO_ACTOR_ID = '00000000-0000-0000-0000-000000000101'
const CMO_ACTOR_KEY = 'agent:cmo' as const
const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const schemaName = `brain_cmo_lineage_${randomUUID().replaceAll('-', '_')}`

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
    throw new Error('The CMO lineage integration database is unavailable')
  }
  return database
}

const createCmoFixture = async (
  binding: 'bound' | 'unbound' = 'bound'
): Promise<CmoFixture> => {
  const unique = randomUUID()
  const brandId = randomUUID()
  const humanActorId = randomUUID()
  const organizationId = `organization:${unique}`
  const userId = `user:${unique}`
  const currentDatabase = requireDatabase()

  await currentDatabase.insert(user).values({
    email: `${unique}@example.test`,
    id: userId,
    name: 'CMO lineage owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'CMO lineage organization',
    slug: `cmo-lineage-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role: 'owner',
    userId,
  })
  await currentDatabase.insert(brands).values({
    id: brandId,
    name: 'CMO lineage brand',
    organizationId,
    slug: `cmo-lineage-${unique}`,
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
    input: { title: 'Typed Action lineage' },
  })
  const sessionId = `session:${unique}`
  if (binding === 'bound') {
    await bindCmoSession({
      access: memberAccess,
      database: currentDatabase,
      input: {
        conversationId: conversation.id,
        sessionId,
        source: 'proxy-create-response',
      },
    })
  }

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

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for CMO lineage tests')
  }

  adminPool = createDatabasePool({ connectionString: databaseUrl, max: 1 })
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`)

  const scopedUrl = new URL(databaseUrl)
  scopedUrl.searchParams.set('options', `-c search_path=${schemaName},public`)
  const scopedDatabasePool = createDatabasePool({
    connectionString: scopedUrl.toString(),
    max: 3,
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

describe('typed CMO Action lineage on PostgreSQL', () => {
  it('denies canonical CMO mutations until the exact session is bound', async () => {
    const fixture = await createCmoFixture('unbound')
    const access = fixture.turnAccess({
      callId: `call:${randomUUID()}`,
      turnId: `turn:${randomUUID()}`,
    })
    const input = {
      acceptanceCriteria: null,
      constraints: null,
      requestId: `declare:${randomUUID()}`,
      statement: 'Reject unbound CMO mutation lineage.',
    }

    await expect(
      declareIntentFromCmo({ access, database: requireDatabase(), input })
    ).rejects.toMatchObject({
      code: 'access_denied',
      message: 'The CMO root session binding is invalid',
    } satisfies Partial<BrainError>)

    await bindCmoSession({
      access: fixture.memberAccess,
      database: requireDatabase(),
      input: {
        conversationId: fixture.conversationId,
        sessionId: fixture.sessionId,
        source: 'proxy-create-response',
      },
    })

    await expect(
      declareIntentFromCmo({ access, database: requireDatabase(), input })
    ).resolves.toMatchObject({ outcome: 'intent_declared' })
  })

  it('uses indexed columns for turn and conversation continuity and preserves replay', async () => {
    const fixture = await createCmoFixture()
    const declareAccess = fixture.turnAccess({
      callId: `call:${randomUUID()}`,
      turnId: `turn:${randomUUID()}`,
    })
    const declareInput = {
      acceptanceCriteria: [{ metric: 'a named primary audience' }],
      constraints: null,
      requestId: `declare:${randomUUID()}`,
      statement: 'Define one specific launch audience.',
    }
    const declared = await declareIntentFromCmo({
      access: declareAccess,
      database: requireDatabase(),
      input: declareInput,
    })
    await expect(
      loadCmoIntentTarget({
        access: declareAccess,
        database: requireDatabase(),
      })
    ).resolves.toEqual({ id: declared.intentId, revision: 1 })

    const refineAccess = fixture.turnAccess({
      callId: `call:${randomUUID()}`,
      turnId: `turn:${randomUUID()}`,
    })
    await expect(
      loadCmoIntentTarget({ access: refineAccess, database: requireDatabase() })
    ).resolves.toEqual({ id: declared.intentId, revision: 1 })

    const refineRequestId = `refine:${randomUUID()}`
    const refineInput = {
      acceptanceCriteria: [{ metric: 'audience and buying trigger are named' }],
      constraints: null,
      expectedRevision: 1,
      intentId: declared.intentId,
      requestId: refineRequestId,
    }
    const refined = await refineIntentFromCmo({
      access: refineAccess,
      database: requireDatabase(),
      input: refineInput,
    })
    await expect(
      loadCmoRefineIntentTarget({
        access: refineAccess,
        database: requireDatabase(),
        requestId: refineRequestId,
      })
    ).resolves.toEqual({ id: declared.intentId, revision: 1 })
    await expect(
      refineIntentFromCmo({
        access: refineAccess,
        database: requireDatabase(),
        input: refineInput,
      })
    ).resolves.toEqual(refined)

    const requestAccess = fixture.turnAccess({
      callId: `call:${randomUUID()}`,
      turnId: `turn:${randomUUID()}`,
    })
    const requested = await requestSpecialistWork({
      access: requestAccess,
      database: requireDatabase(),
      input: {
        intentId: declared.intentId,
        kind: PRODUCT_MARKETER_TASK_KIND,
        payload: { purpose: 'enrich_brand_context' },
        requestId: `specialist:${randomUUID()}`,
      },
    })
    if (requested.disposition !== 'created') {
      throw new Error('The lineage fixture did not create a specialist task')
    }
    await requireDatabase()
      .update(tasks)
      .set({
        completion: {
          intentAcceptance: null,
          openQuestions: ['Which customer segment should be prioritized?'],
          outputObjectIds: [],
          result: {
            outcome: 'needs_input',
            reason: 'missing_human_context',
          },
          status: 'blocked',
          summary: 'One explicit customer priority is required.',
        },
        finishedAt: new Date(),
        outcomeCode: 'blocked',
        status: 'succeeded',
      })
      .where(eq(tasks.id, requested.taskId))

    const resolveAccess = fixture.turnAccess({
      callId: `call:${randomUUID()}`,
      turnId: `turn:${randomUUID()}`,
    })
    const resolved = await resolveTaskQuestions({
      access: resolveAccess,
      database: requireDatabase(),
      input: {
        disposition: 'answered',
        rationale: 'The owner answered in the current CMO conversation.',
        requestId: `resolve:${randomUUID()}`,
        taskId: requested.taskId,
      },
    })

    const writtenActions = await requireDatabase()
      .select({
        callId: actions.callId,
        conversationId: actions.conversationId,
        id: actions.id,
        sessionId: actions.sessionId,
        turnId: actions.turnId,
        type: actions.type,
      })
      .from(actions)
      .where(
        and(
          eq(actions.brandId, fixture.brandId),
          inArray(actions.id, [
            declared.actionId,
            refined.actionId,
            requested.actionId,
            resolved.actionId,
          ])
        )
      )
      .orderBy(asc(actions.createdAt), asc(actions.id))
    expect(writtenActions).toHaveLength(4)

    const expectedLineage = new Map([
      ['intent_declared', declareAccess],
      ['intent_refined', refineAccess],
      ['specialist_work_requested', requestAccess],
      ['task_questions_resolved', resolveAccess],
    ])
    for (const action of writtenActions) {
      const expected = expectedLineage.get(action.type)
      expect(expected).toBeDefined()
      expect(action).toMatchObject({
        callId: expected?.callId,
        conversationId: fixture.conversationId,
        sessionId: fixture.sessionId,
        turnId: expected?.turnId,
      })
    }
  })

  it('fails closed when typed lineage and immutable receipt provenance disagree', async () => {
    const fixture = await createCmoFixture()
    const directIntent = await declareIntent({
      access: fixture.memberAccess,
      database: requireDatabase(),
      input: {
        acceptanceCriteria: null,
        constraints: null,
        requestId: `direct:${randomUUID()}`,
        statement: 'Keep the durable target explicit.',
      },
    })
    const access = fixture.turnAccess({
      callId: `call:${randomUUID()}`,
      turnId: `turn:${randomUUID()}`,
    })
    const actionId = randomUUID()
    await requireDatabase()
      .insert(actions)
      .values({
        actorId: CMO_ACTOR_ID,
        brandId: fixture.brandId,
        callId: access.callId,
        conversationId: access.conversationId,
        effectClass: 'graph-internal',
        id: actionId,
        intentId: directIntent.intentId,
        payload: {
          actionId,
          intentId: directIntent.intentId,
          intentRevision: 1,
          outcome: 'intent_declared',
          producerContext: {
            authorizingHumanActorId: fixture.memberAccess.humanActorId,
            callId: access.callId,
            conversationId: access.conversationId,
            kind: 'cmo-interactive',
            sessionId: access.sessionId,
            turnId: `mismatched:${randomUUID()}`,
          },
        },
        policySnapshot: {},
        rationale: 'Exercise fail-closed lineage validation',
        sessionId: access.sessionId,
        turnId: access.turnId,
        type: 'intent_declared',
      })

    await expect(
      loadCmoIntentTarget({ access, database: requireDatabase() })
    ).rejects.toThrow('The current CMO turn has invalid Intent provenance')
  })
})
