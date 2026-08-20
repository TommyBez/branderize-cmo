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
import { cancelTask } from './task-cancellation'
import {
  claimNextDueHumanCommitment,
  type HumanCommitmentClaimResult,
} from './task-claim-human'
import { SERIALIZED_COMMITMENT_FIXTURE_KIND } from './task-commitment-contracts'
import {
  isDismissedCommitmentDisposition,
  prepareCommitment,
} from './task-prepare-commitment'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const TEST_TIMEOUT_MS = 30_000
const TOKEN_LIKE_PATTERN =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret|sk_live|re_[A-Za-z0-9]{16,}/iu
const schemaName = `brain_serialize_cancel_${randomUUID().replaceAll('-', '_')}`
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
    throw new Error('The cancellation integration database is unavailable')
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
    name: 'Cancellation owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'Cancellation organization',
    slug: `cancel-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role,
    userId,
  })
  await currentDatabase.insert(brands).values({
    id: brandId,
    name: 'Cancellation brand',
    organizationId,
    slug: `cancel-${unique}`,
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

const prepareNotion = async ({
  access,
  reportObjectId,
  requestId = `prepare:${randomUUID()}`,
  title = 'Launch page',
}: {
  readonly access: TrustedMemberAccess
  readonly reportObjectId?: string
  readonly requestId?: string
  readonly title?: string
}) => {
  const resolvedReportId = reportObjectId ?? (await insertReport(access))
  const receipt = await prepareCommitment({
    access,
    database: requireDatabase(),
    input: {
      kind: CONTENT_NOTION_PAGE_TASK_KIND,
      payload: { reportObjectId: resolvedReportId, title },
      requestId,
    },
  })
  if (isDismissedCommitmentDisposition(receipt)) {
    throw new Error('Expected a prepared commitment')
  }
  return { receipt, reportObjectId: resolvedReportId, requestId, title }
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
      commitmentConflictKey: tasks.commitmentConflictKey,
      finishedAt: tasks.finishedAt,
      kind: tasks.kind,
      payload: tasks.payload,
      payloadHash: tasks.payloadHash,
      status: tasks.status,
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

const insertSerializedFixture = async ({
  access,
  status,
  targetKey,
}: {
  readonly access: TrustedMemberAccess
  readonly status: 'awaiting_approval' | 'queued'
  readonly targetKey: string
}): Promise<string> => {
  const taskId = randomUUID()
  const payload = { targetKey }
  await requireDatabase()
    .insert(tasks)
    .values({
      activation: 'human',
      brandId: access.brandId,
      creationHash: requestHash({
        brandId: access.brandId,
        kind: SERIALIZED_COMMITMENT_FIXTURE_KIND,
        payload,
        taskId,
      }),
      executionMode: 'direct',
      id: taskId,
      idempotencyKey: `task:fixture:${taskId}`,
      kind: SERIALIZED_COMMITMENT_FIXTURE_KIND,
      payload,
      payloadHash: requestHash(payload),
      revision: 1,
      status: 'awaiting_approval',
      subjectKey: `commitment:${taskId}`,
      workerKey: 'content',
    })
  if (status === 'queued') {
    const approved = await approveTask({
      access,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve-fixture:${taskId}`,
        taskId,
      },
    })
    if (approved.outcome !== 'approved') {
      throw new Error('Expected the serialized fixture to approve')
    }
  }
  return taskId
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for cancellation tests')
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

describe('cancelTask', () => {
  it.each(['awaiting_approval', 'queued'] as const)(
    'cancels a %s commitment without writing dismissal memory',
    { timeout: TEST_TIMEOUT_MS },
    async (fromStatus) => {
      const access = await createMemberAccess()
      await connectNotion(access)
      const prepared = await prepareNotion({ access })
      if (fromStatus === 'queued') {
        const approved = await approveTask({
          access,
          database: requireDatabase(),
          input: {
            expectedRevision: 1,
            requestId: `approve:${randomUUID()}`,
            taskId: prepared.receipt.taskId,
          },
        })
        expect(approved.outcome).toBe('approved')
      }
      const cancelled = await cancelTask({
        access,
        database: requireDatabase(),
        input: {
          requestId: `cancel:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
      const row = await readTask(prepared.receipt.taskId)
      expect(cancelled.outcome).toBe('cancelled')
      expect(row.status).toBe('cancelled')
      expect(row.finishedAt).toBeInstanceOf(Date)
      expect(
        await countActions({
          brandId: access.brandId,
          taskId: prepared.receipt.taskId,
          type: 'commitment_cancelled',
        })
      ).toBe(1)
      expect(
        await countActions({
          brandId: access.brandId,
          type: 'commitment_dismissed',
        })
      ).toBe(0)
      expect(JSON.stringify(row)).not.toMatch(TOKEN_LIKE_PATTERN)

      const again = await prepareNotion({
        access,
        reportObjectId: prepared.reportObjectId,
        title: prepared.title,
      })
      expect(again.receipt.taskId).not.toBe(prepared.receipt.taskId)
      expect((await readTask(again.receipt.taskId)).status).toBe(
        'awaiting_approval'
      )
      expect((await readTask(prepared.receipt.taskId)).status).toBe('cancelled')
    }
  )

  it('lets cancel win against a later claim and writes one Cancellation Action', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    await connectNotion(access)
    const prepared = await prepareNotion({ access })
    await approveTask({
      access,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    const cancelled = await cancelTask({
      access,
      database: requireDatabase(),
      input: {
        requestId: `cancel-first:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    const claimed = await claimOwnCommitment({
      now: new Date(),
      taskId: prepared.receipt.taskId,
    })
    expect(cancelled.outcome).toBe('cancelled')
    expect(claimed.outcome).toBe('empty')
    expect((await readTask(prepared.receipt.taskId)).status).toBe('cancelled')
    expect(
      await countActions({
        brandId: access.brandId,
        taskId: prepared.receipt.taskId,
        type: 'commitment_cancelled',
      })
    ).toBe(1)
  })

  it('lets claim win against a later cancel and writes no Cancellation Action', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    await connectNotion(access)
    const prepared = await prepareNotion({ access })
    await approveTask({
      access,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    const claimed = await claimOwnCommitment({
      now: new Date(),
      taskId: prepared.receipt.taskId,
    })
    const cancelled = await cancelTask({
      access,
      database: requireDatabase(),
      input: {
        requestId: `cancel-lost:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    expect(claimed.outcome).toBe('claimed')
    expect(cancelled).toEqual({
      outcome: 'already_claimed',
      taskId: prepared.receipt.taskId,
    })
    expect((await readTask(prepared.receipt.taskId)).status).toBe('running')
    expect(
      await countActions({
        brandId: access.brandId,
        taskId: prepared.receipt.taskId,
        type: 'commitment_cancelled',
      })
    ).toBe(0)
  })

  it('produces exactly one winner for concurrent cancel-versus-claim', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    await connectNotion(access)
    const prepared = await prepareNotion({ access })
    await approveTask({
      access,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    const results = await Promise.allSettled([
      cancelTask({
        access,
        database: requireDatabase(),
        input: {
          requestId: `cancel-race:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      }),
      claimOwnCommitment({
        now: new Date(),
        taskId: prepared.receipt.taskId,
      }),
    ])
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    const cancelResult =
      results[0]?.status === 'fulfilled' ? results[0].value : undefined
    const claimResult =
      results[1]?.status === 'fulfilled' ? results[1].value : undefined
    const row = await readTask(prepared.receipt.taskId)
    const cancellationCount = await countActions({
      brandId: access.brandId,
      taskId: prepared.receipt.taskId,
      type: 'commitment_cancelled',
    })
    if (cancelResult?.outcome === 'cancelled') {
      expect(claimResult?.outcome).toBe('empty')
      expect(row.status).toBe('cancelled')
      expect(cancellationCount).toBe(1)
    } else {
      expect(cancelResult).toEqual({
        outcome: 'already_claimed',
        taskId: prepared.receipt.taskId,
      })
      expect(claimResult?.outcome).toBe('claimed')
      expect(row.status).toBe('running')
      expect(cancellationCount).toBe(0)
    }
  })

  it('releases a serialized fixture conflict slot without approving the loser', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const targetKey = `shared-target:${randomUUID()}`
    const blockerId = await insertSerializedFixture({
      access,
      status: 'queued',
      targetKey,
    })
    const loserId = await insertSerializedFixture({
      access,
      status: 'awaiting_approval',
      targetKey,
    })
    const busy = await approveTask({
      access,
      database: requireDatabase(),
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

    const cancelled = await cancelTask({
      access,
      database: requireDatabase(),
      input: {
        requestId: `cancel-blocker:${randomUUID()}`,
        taskId: blockerId,
      },
    })
    expect(cancelled.outcome).toBe('cancelled')
    expect((await readTask(blockerId)).status).toBe('cancelled')
    expect((await readTask(loserId)).status).toBe('awaiting_approval')
    expect(
      await countActions({
        brandId: access.brandId,
        taskId: loserId,
        type: 'commitment_approved',
      })
    ).toBe(0)

    const approvedLoser = await approveTask({
      access,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve-loser:${randomUUID()}`,
        taskId: loserId,
      },
    })
    expect(approvedLoser.outcome).toBe('approved')
    expect((await readTask(loserId)).status).toBe('queued')
    expect((await readTask(loserId)).commitmentConflictKey).toBe(
      `serialized-fixture:${targetKey}`
    )
  })

  it('fails closed for viewer cancel with no Action', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const owner = await createMemberAccess('owner')
    const prepared = await prepareNotion({ access: owner })
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
      cancelTask({
        access: viewerAccess,
        database: requireDatabase(),
        input: {
          requestId: `cancel-viewer:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'access_denied',
    } satisfies Partial<BrainError>)
    expect(
      await countActions({
        brandId: owner.brandId,
        taskId: prepared.receipt.taskId,
        type: 'commitment_cancelled',
      })
    ).toBe(0)
    expect((await readTask(prepared.receipt.taskId)).status).toBe(
      'awaiting_approval'
    )
  })
})
