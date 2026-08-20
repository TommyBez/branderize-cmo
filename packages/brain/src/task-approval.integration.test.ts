import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { getTaskKind } from '@repo/agents'
import { CONTENT_NOTION_PAGE_TASK_KIND } from '@repo/agents/tasks'
import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { member, organization, user } from '@repo/db/schema/auth'
import {
  actions,
  actors,
  brandConnections,
  brands,
  objects,
  tasks,
} from '@repo/db/schema/domain'
import { executeStatementsSequentially } from '@repo/db/test-support'
import { and, count, eq, ne } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { requestHash } from './canonical'
import type { TrustedMemberAccess } from './context'
import type { BrainError } from './errors'
import { approveTask } from './task-approval'
import {
  claimNextDueHumanCommitment,
  type HumanCommitmentClaimResult,
} from './task-claim-human'
import { SERIALIZED_COMMITMENT_FIXTURE_KIND } from './task-commitment-contracts'
import { prepareCommitment } from './task-prepare-commitment'
import { requestSpecialistWork } from './task-request'
import {
  settleHumanCommitmentResult,
  settleStaleHumanCommitments,
} from './task-result'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const TEST_TIMEOUT_MS = 30_000
const TOKEN_LIKE_PATTERN =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret|sk_live|re_[A-Za-z0-9]{16,}/iu
const schemaName = `brain_approval_result_${randomUUID().replaceAll('-', '_')}`
const migrationFiles = [
  '0000_phase0_foundation.sql',
  '0001_brand_connections.sql',
  '0002_human_commitment_lane.sql',
] as const

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The approval integration database is unavailable')
  }
  return database
}

const createMemberAccess = async (
  role: TrustedMemberAccess['role'] = 'owner'
): Promise<TrustedMemberAccess> => {
  const unique = randomUUID()
  const brandId = randomUUID()
  const humanActorId = randomUUID()
  const organizationId = `organization:${unique}`
  const userId = `user:${unique}`
  const currentDatabase = requireDatabase()

  await currentDatabase.insert(user).values({
    email: `${unique}@example.test`,
    id: userId,
    name: 'Approval owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'Approval organization',
    slug: `approval-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role,
    userId,
  })
  await currentDatabase.insert(brands).values({
    id: brandId,
    name: 'Approval brand',
    organizationId,
    slug: `approval-${unique}`,
    websiteUrl: `https://${unique}.example.test`,
  })
  await currentDatabase.insert(actors).values({
    actorKey: `human:${userId}`,
    id: humanActorId,
    type: 'human',
    userId,
  })

  return {
    brandId,
    humanActorId,
    humanActorKey: `human:${userId}`,
    organizationId,
    role,
    userId,
  }
}

const insertReport = async (access: TrustedMemberAccess): Promise<string> => {
  const actionId = randomUUID()
  const reportObjectId = randomUUID()
  const content = { summary: 'Draft', title: 'Content report' }
  await requireDatabase()
    .insert(actions)
    .values({
      actorId: access.humanActorId,
      brandId: access.brandId,
      effectClass: 'graph-internal',
      id: actionId,
      payload: { objectId: reportObjectId },
      policySnapshot: { authorization: 'human-direct-mutation' },
      rationale: 'Seed a Content report for the Notion commitment',
      type: 'content_brief_seeded',
    })
  await requireDatabase()
    .insert(objects)
    .values({
      brandId: access.brandId,
      content,
      contentText: JSON.stringify(content),
      id: reportObjectId,
      producedBy: actionId,
      status: 'active',
      type: 'report',
    })
  return reportObjectId
}

const prepareNotion = async (
  access: TrustedMemberAccess,
  requestId = `prepare:${randomUUID()}`
) => {
  const reportObjectId = await insertReport(access)
  const title = 'Launch page'
  const receipt = await prepareCommitment({
    access,
    database: requireDatabase(),
    input: {
      kind: CONTENT_NOTION_PAGE_TASK_KIND,
      payload: { reportObjectId, title },
      requestId,
    },
  })
  return { receipt, reportObjectId, requestId, title }
}

const countActions = async ({
  brandId,
  taskId,
  type,
}: {
  readonly brandId: string
  readonly taskId?: string
  readonly type: string
}): Promise<number> => {
  const [result] = await requireDatabase()
    .select({ total: count() })
    .from(actions)
    .where(
      taskId === undefined
        ? and(eq(actions.brandId, brandId), eq(actions.type, type))
        : and(
            eq(actions.brandId, brandId),
            eq(actions.taskId, taskId),
            eq(actions.type, type)
          )
    )
  if (result === undefined) {
    throw new Error('The action count query returned no row')
  }
  return result.total
}

const readTask = async (taskId: string) => {
  const [row] = await requireDatabase()
    .select({
      activation: tasks.activation,
      approvalActionId: tasks.approvalActionId,
      approvedAt: tasks.approvedAt,
      commitmentConflictKey: tasks.commitmentConflictKey,
      executionMode: tasks.executionMode,
      outcomeCode: tasks.outcomeCode,
      payload: tasks.payload,
      resultActionId: tasks.resultActionId,
      revision: tasks.revision,
      status: tasks.status,
      subjectKey: tasks.subjectKey,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1)
  if (row === undefined) {
    throw new Error('The commitment task was not found')
  }
  return row
}

const connectNotion = async (access: TrustedMemberAccess) => {
  await requireDatabase()
    .insert(brandConnections)
    .values({
      accountLabel: 'Acme Notion workspace',
      brandId: access.brandId,
      connectorUid: 'notion/branderize-test',
      installationId: 'inst_test_notion_workspace',
      providerSlot: 'notion',
      scopes: ['read', 'write'],
      status: 'active',
    })
}

// The human claim queue is global across brands, so earlier tests leave queued rows behind.
const queuedCommitmentIdsExcept = async (taskId: string): Promise<string[]> => {
  const rows = await requireDatabase()
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.status, 'queued'), ne(tasks.id, taskId)))
  return rows.map((row) => row.id)
}

const claimOwnCommitment = async ({
  now,
  taskId,
}: {
  readonly now: Date
  readonly taskId: string
}): Promise<
  HumanCommitmentClaimResult<typeof CONTENT_NOTION_PAGE_TASK_KIND>
> => {
  const excludeTaskIds = await queuedCommitmentIdsExcept(taskId)
  return await claimNextDueHumanCommitment({
    database: requireDatabase(),
    excludeTaskIds,
    kinds: [CONTENT_NOTION_PAGE_TASK_KIND],
    now,
    workerKey: getTaskKind(CONTENT_NOTION_PAGE_TASK_KIND).workerKey,
  })
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for approval tests')
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

  const migrations = await Promise.all(
    migrationFiles.map(
      async (file) =>
        await readFile(
          new URL(`../../db/drizzle/${file}`, import.meta.url),
          'utf8'
        )
    )
  )
  const statements = migrations.flatMap((migration) =>
    migration
      .split(MIGRATION_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)
  )
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

describe('prepare, approve, claim, and Result settlement', () => {
  it('prepares one awaiting_approval row and replays the same request', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const requestId = `prepare:${randomUUID()}`
    const first = await prepareNotion(access, requestId)
    const replay = await prepareCommitment({
      access,
      database: requireDatabase(),
      input: {
        kind: CONTENT_NOTION_PAGE_TASK_KIND,
        payload: {
          reportObjectId: first.reportObjectId,
          title: first.title,
        },
        requestId,
      },
    })
    const row = await readTask(first.receipt.taskId)

    expect(first.receipt).toEqual(replay)
    expect(row).toMatchObject({
      activation: 'human',
      approvalActionId: null,
      approvedAt: null,
      executionMode: 'direct',
      revision: 1,
      status: 'awaiting_approval',
      subjectKey: `commitment:${first.receipt.taskId}`,
    })
    expect(row.subjectKey).toBe(`commitment:${first.receipt.taskId}`)
    expect(JSON.stringify(row.payload)).not.toMatch(TOKEN_LIKE_PATTERN)
    expect(
      await countActions({
        brandId: access.brandId,
        type: 'commitment_approved',
      })
    ).toBe(0)
    const [taskCount] = await requireDatabase()
      .select({ total: count() })
      .from(tasks)
      .where(eq(tasks.brandId, access.brandId))
    expect(taskCount?.total).toBe(1)
  })

  it('rejects a different hash on the same prepare operation key', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const requestId = `prepare-conflict:${randomUUID()}`
    const first = await prepareNotion(access, requestId)
    const otherReport = await insertReport(access)
    await expect(
      prepareCommitment({
        access,
        database: requireDatabase(),
        input: {
          kind: CONTENT_NOTION_PAGE_TASK_KIND,
          payload: { reportObjectId: otherReport, title: 'Other title' },
          requestId,
        },
      })
    ).rejects.toMatchObject({
      code: 'operation_conflict',
    } satisfies Partial<BrainError>)
    expect((await readTask(first.receipt.taskId)).status).toBe(
      'awaiting_approval'
    )
  })

  it.each(['owner', 'admin', 'member'] as const)(
    'lets a %s approve one commitment into queued',
    { timeout: TEST_TIMEOUT_MS },
    async (role) => {
      const access = await createMemberAccess(role)
      const prepared = await prepareNotion(access)
      const approved = await approveTask({
        access,
        database: requireDatabase(),
        input: {
          expectedRevision: 1,
          requestId: `approve:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
      const row = await readTask(prepared.receipt.taskId)
      expect(approved.outcome).toBe('approved')
      expect(row.status).toBe('queued')
      expect(row.approvalActionId).toBeTruthy()
      expect(row.approvedAt).toBeInstanceOf(Date)
      const [approval] = await requireDatabase()
        .select({
          payload: actions.payload,
          policySnapshot: actions.policySnapshot,
          type: actions.type,
        })
        .from(actions)
        .where(eq(actions.id, row.approvalActionId ?? ''))
        .limit(1)
      expect(approval?.type).toBe('commitment_approved')
      expect(JSON.stringify(approval)).toContain('phase-0-v1')
      expect(JSON.stringify(approval)).not.toMatch(TOKEN_LIKE_PATTERN)
    }
  )

  it('fails closed for viewer, stale revision, already-queued, and cross-tenant', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const owner = await createMemberAccess('owner')
    const prepared = await prepareNotion(owner)
    const viewerSeed = await createMemberAccess('viewer')
    await requireDatabase()
      .insert(member)
      .values({
        id: `member-viewer:${randomUUID()}`,
        organizationId: owner.organizationId,
        role: 'viewer',
        userId: viewerSeed.userId,
      })
    const viewerAccess: TrustedMemberAccess = {
      ...viewerSeed,
      brandId: owner.brandId,
      organizationId: owner.organizationId,
    }

    await expect(
      approveTask({
        access: viewerAccess,
        database: requireDatabase(),
        input: {
          expectedRevision: 1,
          requestId: `approve-viewer:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'access_denied',
    } satisfies Partial<BrainError>)

    await expect(
      approveTask({
        access: owner,
        database: requireDatabase(),
        input: {
          expectedRevision: 2,
          requestId: `approve-stale:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'stale_revision',
    } satisfies Partial<BrainError>)

    const approved = await approveTask({
      access: owner,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve-ok:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    expect(approved.outcome).toBe('approved')

    await expect(
      approveTask({
        access: owner,
        database: requireDatabase(),
        input: {
          expectedRevision: 1,
          requestId: `approve-queued:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'invalid_operation',
    } satisfies Partial<BrainError>)

    const otherBrand = await createMemberAccess('owner')
    await expect(
      approveTask({
        access: otherBrand,
        database: requireDatabase(),
        input: {
          expectedRevision: 1,
          requestId: `approve-cross:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'task_not_found',
    } satisfies Partial<BrainError>)

    expect(
      await countActions({
        brandId: owner.brandId,
        taskId: prepared.receipt.taskId,
        type: 'commitment_approved',
      })
    ).toBe(1)
  })

  it('produces exactly one winner for concurrent double-approve', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const prepared = await prepareNotion(access)
    const results = await Promise.allSettled([
      approveTask({
        access,
        database: requireDatabase(),
        input: {
          expectedRevision: 1,
          requestId: `approve-a:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      }),
      approveTask({
        access,
        database: requireDatabase(),
        input: {
          expectedRevision: 1,
          requestId: `approve-b:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      }),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(
      await countActions({
        brandId: access.brandId,
        taskId: prepared.receipt.taskId,
        type: 'commitment_approved',
      })
    ).toBe(1)
    expect((await readTask(prepared.receipt.taskId)).status).toBe('queued')
  })

  it('returns target_busy for the serialized fixture without writing Approval', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const blockerId = randomUUID()
    const loserId = randomUUID()
    const blockerActionId = randomUUID()
    const currentDatabase = requireDatabase()
    await currentDatabase.insert(tasks).values({
      activation: 'human',
      brandId: access.brandId,
      creationHash: `hash-blocker-${blockerId}`,
      executionMode: 'direct',
      id: blockerId,
      idempotencyKey: `task:fixture-blocker:${blockerId}`,
      kind: SERIALIZED_COMMITMENT_FIXTURE_KIND,
      payload: { targetKey: 'shared-target' },
      payloadHash: requestHash({ targetKey: 'shared-target' }),
      revision: 1,
      status: 'awaiting_approval',
      subjectKey: `commitment:${blockerId}`,
      workerKey: 'content',
    })
    await currentDatabase.insert(actions).values({
      actorId: access.humanActorId,
      brandId: access.brandId,
      effectClass: 'reversible-external',
      id: blockerActionId,
      payload: { outcome: 'approved', taskId: blockerId },
      policySnapshot: { policyVersion: 'phase-0-v1' },
      rationale: 'Seed a serialized blocker',
      taskId: blockerId,
      type: 'commitment_approved',
    })
    await currentDatabase
      .update(tasks)
      .set({
        approvalActionId: blockerActionId,
        approvedAt: new Date(),
        commitmentConflictKey: 'serialized-fixture:shared-target',
        status: 'queued',
      })
      .where(eq(tasks.id, blockerId))
    await currentDatabase.insert(tasks).values({
      activation: 'human',
      brandId: access.brandId,
      creationHash: `hash-loser-${loserId}`,
      executionMode: 'direct',
      id: loserId,
      idempotencyKey: `task:fixture-loser:${loserId}`,
      kind: SERIALIZED_COMMITMENT_FIXTURE_KIND,
      payload: { targetKey: 'shared-target' },
      payloadHash: requestHash({ targetKey: 'shared-target' }),
      revision: 1,
      status: 'awaiting_approval',
      subjectKey: `commitment:${loserId}`,
      workerKey: 'content',
    })

    const busy = await approveTask({
      access,
      database: currentDatabase,
      input: {
        expectedRevision: 1,
        requestId: `approve-busy:${randomUUID()}`,
        taskId: loserId,
      },
    })
    expect(busy).toEqual({
      blockingTaskId: blockerId,
      outcome: 'target_busy',
      taskId: loserId,
    })
    expect((await readTask(loserId)).status).toBe('awaiting_approval')
    expect(
      await countActions({
        brandId: access.brandId,
        taskId: loserId,
        type: 'commitment_approved',
      })
    ).toBe(0)
  })

  it('claims without credit_ledger and settles one scripted Result', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    await connectNotion(access)
    const prepared = await prepareNotion(access)
    await approveTask({
      access,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve-claim:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    const claimed = await claimOwnCommitment({
      now: new Date(),
      taskId: prepared.receipt.taskId,
    })
    expect(claimed.outcome).toBe('claimed')
    if (claimed.outcome !== 'claimed') {
      throw new Error('Expected a claimed human commitment')
    }
    const settlement = await settleHumanCommitmentResult({
      claim: claimed.claim,
      database: requireDatabase(),
      now: new Date(),
      outcome: {
        outcome: 'accepted',
        receipt: {
          accountLabel: 'Acme Notion workspace',
          pageId: 'page_scripted_01',
          pageUrl: 'https://notion.example/page_scripted_01',
        },
      },
    })
    const row = await readTask(prepared.receipt.taskId)
    expect(settlement.status).toBe('succeeded')
    expect(row.status).toBe('succeeded')
    expect(row.resultActionId).toBe(settlement.actionId)
    const [result] = await requireDatabase()
      .select({ payload: actions.payload })
      .from(actions)
      .where(eq(actions.id, settlement.actionId))
      .limit(1)
    expect(result?.payload).toMatchObject({
      outcome: 'accepted',
      receipt: {
        accountLabel: 'Acme Notion workspace',
        pageId: 'page_scripted_01',
      },
    })
    expect(JSON.stringify(result?.payload)).not.toMatch(TOKEN_LIKE_PATTERN)
    expect(JSON.stringify(row)).not.toMatch(TOKEN_LIKE_PATTERN)
    expect(
      await countActions({
        brandId: access.brandId,
        taskId: prepared.receipt.taskId,
        type: 'commitment_result',
      })
    ).toBe(1)
  })

  it('leaves a disconnected Notion slot queued with no provider Result', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const prepared = await prepareNotion(access)
    await approveTask({
      access,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve-disconnected:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    const claimed = await claimOwnCommitment({
      now: new Date(),
      taskId: prepared.receipt.taskId,
    })
    expect(claimed).toMatchObject({
      capabilityKey: 'connection:notion',
      outcome: 'capability_missing',
      taskId: prepared.receipt.taskId,
    })
    expect((await readTask(prepared.receipt.taskId)).status).toBe('queued')
    expect(
      await countActions({
        brandId: access.brandId,
        taskId: prepared.receipt.taskId,
        type: 'commitment_result',
      })
    ).toBe(0)
  })

  it('settles a crash after claim that ages past 10 minutes as outcome_unknown', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    await connectNotion(access)
    const prepared = await prepareNotion(access)
    await approveTask({
      access,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve-stale:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    const claimedAt = new Date('2026-08-20T10:00:00.000Z')
    const claimed = await claimOwnCommitment({
      now: claimedAt,
      taskId: prepared.receipt.taskId,
    })
    expect(claimed.outcome).toBe('claimed')
    const later = new Date(claimedAt.getTime() + 11 * 60 * 1000)
    const settlements = await settleStaleHumanCommitments({
      database: requireDatabase(),
      kinds: [CONTENT_NOTION_PAGE_TASK_KIND],
      now: later,
      workerKey: 'content',
    })
    expect(settlements).toHaveLength(1)
    expect(settlements[0]?.status).toBe('outcome_unknown')
    const row = await readTask(prepared.receipt.taskId)
    expect(row.status).toBe('outcome_unknown')
    expect(row.outcomeCode).toBe('stale_running')
    expect(row.resultActionId).toBeTruthy()
  })

  it('rejects requestSpecialistWork for the Notion commitment kind', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const reportObjectId = await insertReport(access)
    await expect(
      requestSpecialistWork({
        access: {
          ...access,
          callId: 'call-1',
          cmoActorId: '00000000-0000-0000-0000-000000000101',
          cmoActorKey: 'agent:cmo',
          conversationId: randomUUID(),
          rootSessionId: 'session-1',
          sessionId: 'session-1',
          turnId: 'turn-1',
        },
        database: requireDatabase(),
        input: {
          intentId: randomUUID(),
          kind: CONTENT_NOTION_PAGE_TASK_KIND,
          payload: { reportObjectId, title: 'Launch page' },
          requestId: `specialist:${randomUUID()}`,
        },
      })
    ).rejects.toMatchObject({
      code: 'invalid_task',
    } satisfies Partial<BrainError>)
  })
})
