import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { CONTENT_NOTION_PAGE_TASK_KIND } from '@repo/agents/tasks'
import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { member, organization, user } from '@repo/db/schema/auth'
import { actions, actors, brands, objects, tasks } from '@repo/db/schema/domain'
import { executeStatementsSequentially } from '@repo/db/test-support'
import { and, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { TrustedMemberAccess } from './context'
import type { BrainError } from './errors'
import { approveTask } from './task-approval'
import { dismissTask, reopenTask } from './task-dismissal'
import {
  isDismissedCommitmentDisposition,
  prepareCommitment,
} from './task-prepare-commitment'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const TEST_TIMEOUT_MS = 30_000
const TOKEN_LIKE_PATTERN =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret|sk_live|re_[A-Za-z0-9]{16,}/iu
const schemaName = `brain_serialize_dismiss_${randomUUID().replaceAll('-', '_')}`
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
    throw new Error('The dismissal integration database is unavailable')
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
    name: 'Dismissal owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'Dismissal organization',
    slug: `dismissal-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role,
    userId,
  })
  await currentDatabase.insert(brands).values({
    id: brandId,
    name: 'Dismissal brand',
    organizationId,
    slug: `dismissal-${unique}`,
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
      finishedAt: tasks.finishedAt,
      kind: tasks.kind,
      payload: tasks.payload,
      payloadHash: tasks.payloadHash,
      revision: tasks.revision,
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

const countBrandTasks = async (brandId: string): Promise<number> => {
  const [result] = await requireDatabase()
    .select({ total: count() })
    .from(tasks)
    .where(eq(tasks.brandId, brandId))
  if (result === undefined) {
    throw new Error('The task count query returned no row')
  }
  return result.total
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for dismissal tests')
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

describe('dismiss, reopen, and prepare dismissal memory', () => {
  it('dismisses awaiting_approval, freezes the tuple, and blocks exact prepare', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const prepared = await prepareNotion({ access })
    if (isDismissedCommitmentDisposition(prepared.receipt)) {
      throw new Error('Expected a prepared commitment')
    }
    const requestId = `dismiss:${randomUUID()}`
    const dismissed = await dismissTask({
      access,
      database: requireDatabase(),
      input: {
        rationale: 'The draft is no longer needed.',
        requestId,
        taskId: prepared.receipt.taskId,
      },
    })
    const replay = await dismissTask({
      access,
      database: requireDatabase(),
      input: {
        rationale: 'The draft is no longer needed.',
        requestId,
        taskId: prepared.receipt.taskId,
      },
    })
    const row = await readTask(prepared.receipt.taskId)
    const [dismissal] = await requireDatabase()
      .select({
        payload: actions.payload,
        policySnapshot: actions.policySnapshot,
        requestHash: actions.requestHash,
        type: actions.type,
      })
      .from(actions)
      .where(eq(actions.id, dismissed.actionId))
      .limit(1)

    expect(dismissed).toEqual(replay)
    expect(row.status).toBe('dismissed')
    expect(row.finishedAt).toBeInstanceOf(Date)
    expect(row.revision).toBe(1)
    expect(dismissal?.type).toBe('commitment_dismissed')
    expect(dismissal?.payload).toMatchObject({
      brandId: access.brandId,
      kind: CONTENT_NOTION_PAGE_TASK_KIND,
      payloadHash: row.payloadHash,
      taskId: prepared.receipt.taskId,
    })
    expect(JSON.stringify(dismissal)).toContain('phase-0-v1')
    expect(JSON.stringify(dismissal)).not.toMatch(TOKEN_LIKE_PATTERN)
    expect(JSON.stringify(row)).not.toMatch(TOKEN_LIKE_PATTERN)
    expect(
      await countActions({
        brandId: access.brandId,
        taskId: prepared.receipt.taskId,
        type: 'commitment_dismissed',
      })
    ).toBe(1)

    await expect(
      dismissTask({
        access,
        database: requireDatabase(),
        input: {
          rationale: 'A different reason.',
          requestId,
          taskId: prepared.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'operation_conflict',
    } satisfies Partial<BrainError>)

    const blocked = await prepareNotion({
      access,
      reportObjectId: prepared.reportObjectId,
      title: prepared.title,
    })
    expect(blocked.receipt).toEqual({ disposition: 'dismissed' })
    expect(await countBrandTasks(access.brandId)).toBe(1)
    expect((await readTask(prepared.receipt.taskId)).status).toBe('dismissed')
  })

  it('reopens the payload without resurrecting the dismissed row', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const prepared = await prepareNotion({ access })
    if (isDismissedCommitmentDisposition(prepared.receipt)) {
      throw new Error('Expected a prepared commitment')
    }
    await dismissTask({
      access,
      database: requireDatabase(),
      input: {
        requestId: `dismiss:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    const requestId = `reopen:${randomUUID()}`
    const reopened = await reopenTask({
      access,
      database: requireDatabase(),
      input: {
        requestId,
        taskId: prepared.receipt.taskId,
      },
    })
    const replay = await reopenTask({
      access,
      database: requireDatabase(),
      input: {
        requestId,
        taskId: prepared.receipt.taskId,
      },
    })
    expect(reopened).toEqual(replay)
    expect((await readTask(prepared.receipt.taskId)).status).toBe('dismissed')
    expect((await readTask(prepared.receipt.taskId)).revision).toBe(1)
    expect(
      await countActions({
        brandId: access.brandId,
        taskId: prepared.receipt.taskId,
        type: 'commitment_reopened',
      })
    ).toBe(1)

    const next = await prepareNotion({
      access,
      reportObjectId: prepared.reportObjectId,
      title: prepared.title,
    })
    if (isDismissedCommitmentDisposition(next.receipt)) {
      throw new Error('Expected a new prepared commitment after reopen')
    }
    expect(next.receipt.taskId).not.toBe(prepared.receipt.taskId)
    expect((await readTask(next.receipt.taskId)).status).toBe(
      'awaiting_approval'
    )
    expect((await readTask(prepared.receipt.taskId)).status).toBe('dismissed')
    expect(await countBrandTasks(access.brandId)).toBe(2)
  })

  it('lets a one-field payload change prepare without reopen', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const prepared = await prepareNotion({ access, title: 'Launch page' })
    if (isDismissedCommitmentDisposition(prepared.receipt)) {
      throw new Error('Expected a prepared commitment')
    }
    await dismissTask({
      access,
      database: requireDatabase(),
      input: {
        requestId: `dismiss:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    const changed = await prepareNotion({
      access,
      reportObjectId: prepared.reportObjectId,
      title: 'Launch page revised',
    })
    if (isDismissedCommitmentDisposition(changed.receipt)) {
      throw new Error('Expected a prepared commitment for the edited payload')
    }
    expect(changed.receipt.taskId).not.toBe(prepared.receipt.taskId)
    expect((await readTask(changed.receipt.taskId)).status).toBe(
      'awaiting_approval'
    )
    expect((await readTask(prepared.receipt.taskId)).status).toBe('dismissed')
  })

  it('fails closed for viewer, removed member, already-dismissed, already-queued, and cross-tenant', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const owner = await createMemberAccess('owner')
    const prepared = await prepareNotion({ access: owner })
    if (isDismissedCommitmentDisposition(prepared.receipt)) {
      throw new Error('Expected a prepared commitment')
    }
    const queued = await prepareNotion({ access: owner, title: 'Queued page' })
    if (isDismissedCommitmentDisposition(queued.receipt)) {
      throw new Error('Expected a prepared commitment')
    }
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
    const removed = await createMemberAccess('member')
    await requireDatabase()
      .insert(member)
      .values({
        id: `member-removed:${randomUUID()}`,
        organizationId: owner.organizationId,
        role: 'member',
        userId: removed.userId,
      })
    const removedAccess: TrustedMemberAccess = {
      ...removed,
      brandId: owner.brandId,
      organizationId: owner.organizationId,
    }
    const [removedMember] = await requireDatabase()
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, owner.organizationId),
          eq(member.userId, removed.userId)
        )
      )
      .limit(1)
    if (removedMember === undefined) {
      throw new Error('Expected the extra member row')
    }
    await requireDatabase()
      .delete(member)
      .where(eq(member.id, removedMember.id))

    await expect(
      dismissTask({
        access: viewerAccess,
        database: requireDatabase(),
        input: {
          requestId: `dismiss-viewer:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'access_denied',
    } satisfies Partial<BrainError>)

    await expect(
      dismissTask({
        access: removedAccess,
        database: requireDatabase(),
        input: {
          requestId: `dismiss-removed:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'access_denied',
    } satisfies Partial<BrainError>)

    await dismissTask({
      access: owner,
      database: requireDatabase(),
      input: {
        requestId: `dismiss-ok:${randomUUID()}`,
        taskId: prepared.receipt.taskId,
      },
    })
    await expect(
      dismissTask({
        access: owner,
        database: requireDatabase(),
        input: {
          requestId: `dismiss-again:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'task_closed',
    } satisfies Partial<BrainError>)

    await approveTask({
      access: owner,
      database: requireDatabase(),
      input: {
        expectedRevision: 1,
        requestId: `approve-queued:${randomUUID()}`,
        taskId: queued.receipt.taskId,
      },
    })
    await expect(
      dismissTask({
        access: owner,
        database: requireDatabase(),
        input: {
          requestId: `dismiss-queued:${randomUUID()}`,
          taskId: queued.receipt.taskId,
        },
      })
    ).rejects.toMatchObject({
      code: 'task_closed',
    } satisfies Partial<BrainError>)

    const otherBrand = await createMemberAccess('owner')
    await expect(
      dismissTask({
        access: otherBrand,
        database: requireDatabase(),
        input: {
          requestId: `dismiss-cross:${randomUUID()}`,
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
        type: 'commitment_dismissed',
      })
    ).toBe(1)
    expect(
      await countActions({
        brandId: owner.brandId,
        taskId: queued.receipt.taskId,
        type: 'commitment_dismissed',
      })
    ).toBe(0)
  })

  it('produces exactly one winner for concurrent dismiss-versus-approve', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const prepared = await prepareNotion({ access })
    if (isDismissedCommitmentDisposition(prepared.receipt)) {
      throw new Error('Expected a prepared commitment')
    }
    const results = await Promise.allSettled([
      dismissTask({
        access,
        database: requireDatabase(),
        input: {
          requestId: `dismiss-race:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      }),
      approveTask({
        access,
        database: requireDatabase(),
        input: {
          expectedRevision: 1,
          requestId: `approve-race:${randomUUID()}`,
          taskId: prepared.receipt.taskId,
        },
      }),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const row = await readTask(prepared.receipt.taskId)
    const dismissalCount = await countActions({
      brandId: access.brandId,
      taskId: prepared.receipt.taskId,
      type: 'commitment_dismissed',
    })
    const approvalCount = await countActions({
      brandId: access.brandId,
      taskId: prepared.receipt.taskId,
      type: 'commitment_approved',
    })
    expect(dismissalCount + approvalCount).toBe(1)
    if (dismissalCount === 1) {
      expect(row.status).toBe('dismissed')
      expect(row.finishedAt).toBeInstanceOf(Date)
    } else {
      expect(row.status).toBe('queued')
    }
  })
})
