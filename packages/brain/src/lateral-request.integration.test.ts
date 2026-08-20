import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { getTaskKind } from '@repo/agents'
import {
  CONTENT_BRIEF_TASK_KIND,
  DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
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
  intents,
  objects,
  tasks,
} from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type {
  TrustedCmoTurnAccess,
  TrustedMemberAccess,
  TrustedTaskExecution,
} from './context'
import { bindCmoSession, createCmoConversation } from './conversations'
import { BrainError } from './errors'
import { requestLateralWork } from './lateral-request'
import { claimContextAdapters } from './task-claim-adapters'
import { requestSpecialistWork } from './task-request'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const TEST_TIMEOUT_MS = 30_000
const CMO_ACTOR_ID = '00000000-0000-0000-0000-000000000101'
const CMO_ACTOR_KEY = 'agent:cmo' as const
const CONTENT_ACTOR_ID = '00000000-0000-0000-0000-000000000103'
const CONTENT_ACTOR_KEY = 'agent:content' as const
const schemaName = `brain_lateral_${randomUUID().replaceAll('-', '_')}`

interface BrandFixture {
  readonly access: TrustedCmoTurnAccess
  readonly brandId: string
  readonly intentId: string
}

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The lateral request database is unavailable')
  }
  return database
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

const createMemberAccess = async (): Promise<{
  readonly access: TrustedMemberAccess
  readonly brandId: string
  readonly intentId: string
}> => {
  const unique = randomUUID()
  const actorId = randomUUID()
  const brandId = randomUUID()
  const intentId = randomUUID()
  const organizationId = `organization:${unique}`
  const userId = `user:${unique}`
  const currentDatabase = requireDatabase()

  await currentDatabase.insert(user).values({
    email: `${unique}@example.test`,
    id: userId,
    name: 'Lateral work owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'Lateral work organization',
    slug: `lateral-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role: 'owner',
    userId,
  })
  await currentDatabase.insert(brands).values({
    id: brandId,
    name: 'Lateral work brand',
    organizationId,
    slug: `lateral-${unique}`,
    websiteUrl: `https://lateral-${unique}.example.test`,
  })
  await currentDatabase.insert(actors).values({
    actorKey: `human:${userId}`,
    id: actorId,
    type: 'human',
    userId,
  })
  await currentDatabase.insert(intents).values({
    authorActorId: actorId,
    brandId,
    id: intentId,
    parentIntentId: null,
    revision: 1,
    statement: 'Ship a Content brief into Distribution.',
    status: 'active',
  })
  const brandContextActionId = randomUUID()
  const brandContextObjectId = randomUUID()
  const brandContextContent = { summary: 'Current Brand Context' }
  await currentDatabase.insert(actions).values({
    actorId,
    brandId,
    effectClass: 'graph-internal',
    id: brandContextActionId,
    intentId,
    payload: { objectId: brandContextObjectId },
    policySnapshot: { authorization: 'human-direct-mutation' },
    rationale: 'Seed Brand Context for Distribution claim',
    type: 'brand_context_seeded',
  })
  await currentDatabase.insert(objects).values({
    brandId,
    content: brandContextContent,
    contentText: JSON.stringify(brandContextContent),
    id: brandContextObjectId,
    producedBy: brandContextActionId,
    singletonKey: 'brand-context',
    status: 'active',
    type: 'brand_context',
  })

  return {
    access: {
      brandId,
      humanActorId: actorId,
      humanActorKey: `human:${userId}`,
      organizationId,
      role: 'owner',
      userId,
    },
    brandId,
    intentId,
  }
}

const createBrandFixture = async (): Promise<BrandFixture> => {
  const memberAccess = await createMemberAccess()
  const conversation = await createCmoConversation({
    access: memberAccess.access,
    database: requireDatabase(),
    input: { title: 'Lateral work conversation' },
  })
  const sessionId = `session:${randomUUID()}`
  await bindCmoSession({
    access: memberAccess.access,
    database: requireDatabase(),
    input: {
      conversationId: conversation.id,
      sessionId,
      source: 'proxy-create-response',
    },
  })
  return {
    access: {
      ...memberAccess.access,
      callId: `call:${randomUUID()}`,
      cmoActorId: CMO_ACTOR_ID,
      cmoActorKey: CMO_ACTOR_KEY,
      conversationId: conversation.id,
      rootSessionId: sessionId,
      sessionId,
      turnId: `turn:${randomUUID()}`,
    },
    brandId: memberAccess.brandId,
    intentId: memberAccess.intentId,
  }
}

const startContentTask = async (
  fixture: BrandFixture
): Promise<{
  readonly execution: TrustedTaskExecution
  readonly reportObjectId: string
}> => {
  const currentDatabase = requireDatabase()
  const requested = await requestSpecialistWork({
    access: fixture.access,
    database: currentDatabase,
    input: {
      intentId: fixture.intentId,
      kind: CONTENT_BRIEF_TASK_KIND,
      payload: { purpose: 'draft_content_brief' },
      requestId: `content:${randomUUID()}`,
    },
  })
  const startedAt = new Date('2026-08-20T10:00:00.000Z')
  const sessionId = `session:content:${requested.taskId}`
  await currentDatabase
    .update(tasks)
    .set({
      sessionId,
      startedAt,
      status: 'running',
    })
    .where(eq(tasks.id, requested.taskId))

  const produceActionId = randomUUID()
  const reportObjectId = randomUUID()
  const reportContent = {
    report: { title: 'Homepage brief' },
    source: 'content',
    taskId: requested.taskId,
  }
  await currentDatabase.transaction(async (transaction) => {
    await transaction.insert(actions).values({
      actorId: CONTENT_ACTOR_ID,
      brandId: fixture.brandId,
      effectClass: 'graph-internal',
      id: produceActionId,
      intentId: fixture.intentId,
      payload: { objectId: reportObjectId },
      policySnapshot: { authorization: 'autonomous' },
      rationale: 'Draft the Content brief for the accepted Intent snapshot',
      taskId: requested.taskId,
      type: 'content_brief_drafted',
    })
    await transaction.insert(objects).values({
      brandId: fixture.brandId,
      content: reportContent,
      contentText: JSON.stringify(reportContent),
      id: reportObjectId,
      producedBy: produceActionId,
      status: 'active',
      type: 'report',
    })
  })

  return {
    execution: {
      agentActorId: CONTENT_ACTOR_ID,
      agentActorKey: CONTENT_ACTOR_KEY,
      brandId: fixture.brandId,
      rootSessionId: sessionId,
      sessionId,
      startedAt,
      taskId: requested.taskId,
      workerKey: 'content',
    },
    reportObjectId,
  }
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for lateral request tests')
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
})

afterAll(async () => {
  await databasePool?.end()
  if (adminPool !== undefined) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await adminPool.end()
  }
})

describe('requestLateralWork on PostgreSQL', () => {
  it(
    'inserts a parented Distribution task and observes without rewriting parentage',
    async () => {
      const fixture = await createBrandFixture()
      const { execution, reportObjectId } = await startContentTask(fixture)
      const currentDatabase = requireDatabase()
      const input = {
        kind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
        payload: {
          purpose: 'draft_channel_plan' as const,
          sourceReportObjectId: reportObjectId,
        },
        rationale: 'Turn the Content report into a channel plan.',
        requestId: `lateral:${randomUUID()}`,
      }

      const created = await requestLateralWork({
        access: execution,
        database: currentDatabase,
        input,
      })
      expect(created).toMatchObject({
        disposition: 'created',
        outcome: 'lateral_work_requested',
      })

      const [createdRow] = await currentDatabase
        .select({
          parentTaskId: tasks.parentTaskId,
          payload: tasks.payload,
          status: tasks.status,
          subjectKey: tasks.subjectKey,
          workerKey: tasks.workerKey,
        })
        .from(tasks)
        .where(eq(tasks.id, created.taskId))
        .limit(1)
      expect(createdRow).toEqual({
        parentTaskId: execution.taskId,
        payload: input.payload,
        status: 'queued',
        subjectKey: getTaskKind(DISTRIBUTION_CHANNEL_PLAN_TASK_KIND).subjectKey(
          input.payload
        ),
        workerKey: 'distribution',
      })

      const observed = await requestLateralWork({
        access: execution,
        database: currentDatabase,
        input: {
          ...input,
          requestId: `lateral-observe:${randomUUID()}`,
        },
      })
      expect(observed).toEqual({
        disposition: 'already_active',
        outcome: 'lateral_work_observed',
        taskId: created.taskId,
      })
      const [observedRow] = await currentDatabase
        .select({ parentTaskId: tasks.parentTaskId })
        .from(tasks)
        .where(eq(tasks.id, created.taskId))
        .limit(1)
      expect(observedRow?.parentTaskId).toBe(execution.taskId)

      const cmoChannelPlan = await requestSpecialistWork({
        access: fixture.access,
        database: currentDatabase,
        input: {
          intentId: fixture.intentId,
          kind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
          payload: { purpose: 'draft_channel_plan' },
          requestId: `cmo-channel:${randomUUID()}`,
        },
      })
      expect(cmoChannelPlan.disposition).toBe('created')
      expect(cmoChannelPlan.taskId).not.toBe(created.taskId)
      const activePlans = await currentDatabase
        .select({
          id: tasks.id,
          parentTaskId: tasks.parentTaskId,
          subjectKey: tasks.subjectKey,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.brandId, fixture.brandId),
            eq(tasks.kind, DISTRIBUTION_CHANNEL_PLAN_TASK_KIND)
          )
        )
      expect(activePlans).toHaveLength(2)
      expect(activePlans).toEqual(
        expect.arrayContaining([
          {
            id: created.taskId,
            parentTaskId: execution.taskId,
            subjectKey: getTaskKind(
              DISTRIBUTION_CHANNEL_PLAN_TASK_KIND
            ).subjectKey(input.payload),
          },
          {
            id: cmoChannelPlan.taskId,
            parentTaskId: null,
            subjectKey: 'distribution:channel-plan',
          },
        ])
      )

      const claimContext = await currentDatabase.transaction(
        async (transaction) =>
          await claimContextAdapters['distribution.channel-plan.v1']({
            brandId: fixture.brandId,
            intentSnapshot: {
              acceptance_criteria: null,
              brand_id: fixture.brandId,
              constraints: null,
              intent_id: fixture.intentId,
              intent_revision: 1,
              preauthorizations: [],
              statement: 'Ship a Content brief into Distribution.',
            },
            kind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
            payload: input.payload,
            taskId: created.taskId,
            transaction,
            workerKey: 'distribution',
          })
      )
      expect(claimContext).toMatchObject({
        sourceReportObjectId: reportObjectId,
      })
    },
    TEST_TIMEOUT_MS
  )

  it(
    'fails closed for a missing, foreign, or artifact Object id',
    async () => {
      const fixture = await createBrandFixture()
      const { execution, reportObjectId } = await startContentTask(fixture)
      const currentDatabase = requireDatabase()
      const missingId = randomUUID()

      await expect(
        requestLateralWork({
          access: execution,
          database: currentDatabase,
          input: {
            kind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
            payload: {
              purpose: 'draft_channel_plan',
              sourceReportObjectId: missingId,
            },
            rationale: 'Use a report that does not exist.',
            requestId: `lateral-missing:${randomUUID()}`,
          },
        })
      ).rejects.toMatchObject({
        code: 'invalid_output',
        name: BrainError.name,
      })

      const artifactActionId = randomUUID()
      const artifactObjectId = randomUUID()
      await currentDatabase.transaction(async (transaction) => {
        await transaction.insert(actions).values({
          actorId: CONTENT_ACTOR_ID,
          brandId: fixture.brandId,
          effectClass: 'graph-internal',
          id: artifactActionId,
          intentId: fixture.intentId,
          payload: { objectId: artifactObjectId },
          policySnapshot: { authorization: 'autonomous' },
          rationale: 'Store a blob-backed artifact',
          taskId: execution.taskId,
          type: 'artifact_recorded',
        })
        await transaction.insert(objects).values({
          brandId: fixture.brandId,
          content: { kind: 'artifact' },
          contentText: '{"kind":"artifact"}',
          id: artifactObjectId,
          producedBy: artifactActionId,
          status: 'active',
          type: 'artifact',
        })
      })
      await expect(
        requestLateralWork({
          access: execution,
          database: currentDatabase,
          input: {
            kind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
            payload: {
              purpose: 'draft_channel_plan',
              sourceReportObjectId: artifactObjectId,
            },
            rationale: 'Use an artifact as if it were a report.',
            requestId: `lateral-artifact:${randomUUID()}`,
          },
        })
      ).rejects.toMatchObject({
        code: 'invalid_output',
        name: BrainError.name,
      })

      const second = await createBrandFixture()
      const foreign = await startContentTask(second)
      await expect(
        requestLateralWork({
          access: execution,
          database: currentDatabase,
          input: {
            kind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
            payload: {
              purpose: 'draft_channel_plan',
              sourceReportObjectId: foreign.reportObjectId,
            },
            rationale: 'Use another brand report.',
            requestId: `lateral-foreign:${randomUUID()}`,
          },
        })
      ).rejects.toMatchObject({
        code: 'invalid_output',
        name: BrainError.name,
      })

      const leftoverTasks = await currentDatabase
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.brandId, fixture.brandId),
            eq(tasks.kind, DISTRIBUTION_CHANNEL_PLAN_TASK_KIND)
          )
        )
      expect(leftoverTasks).toEqual([])
      expect(reportObjectId).not.toBe(artifactObjectId)
    },
    TEST_TIMEOUT_MS
  )
})
