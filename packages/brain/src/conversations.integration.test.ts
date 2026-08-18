import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { executeStatementsSequentially } from '@repo/db/test-support'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { TrustedMemberAccess } from './context'
import {
  authorizeCmoSession,
  bindCmoSession,
  checkpointCmoConversation,
  createCmoConversation,
  listCmoConversations,
  openCmoConversation,
  readPersistedCmoEvents,
} from './conversations'
import type { BrainError } from './errors'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const schemaName = `brain_conversations_${randomUUID().replaceAll('-', '_')}`

const fixture = {
  aliceActorId: randomUUID(),
  aliceUserId: `alice:${randomUUID()}`,
  bobActorId: randomUUID(),
  bobUserId: `bob:${randomUUID()}`,
  brandAId: randomUUID(),
  brandBId: randomUUID(),
  organizationAId: `organization-a:${randomUUID()}`,
  organizationBId: `organization-b:${randomUUID()}`,
  otherUserActorId: randomUUID(),
  otherUserId: `other:${randomUUID()}`,
}

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The conversations integration database is unavailable')
  }
  return database
}

const requireDatabasePool = (): ReturnType<typeof createDatabasePool> => {
  if (databasePool === undefined) {
    throw new Error('The conversations integration pool is unavailable')
  }
  return databasePool
}

const accessFor = ({
  actorId,
  brandId,
  organizationId,
  role,
  userId,
}: {
  readonly actorId: string
  readonly brandId: string
  readonly organizationId: string
  readonly role: TrustedMemberAccess['role']
  readonly userId: string
}): TrustedMemberAccess => ({
  brandId,
  humanActorId: actorId,
  humanActorKey: `human:${userId}`,
  organizationId,
  role,
  userId,
})

const aliceAccess = (): TrustedMemberAccess =>
  accessFor({
    actorId: fixture.aliceActorId,
    brandId: fixture.brandAId,
    organizationId: fixture.organizationAId,
    role: 'owner',
    userId: fixture.aliceUserId,
  })

const bobAccess = (): TrustedMemberAccess =>
  accessFor({
    actorId: fixture.bobActorId,
    brandId: fixture.brandAId,
    organizationId: fixture.organizationAId,
    role: 'admin',
    userId: fixture.bobUserId,
  })

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for brain integration tests')
  }

  adminPool = createDatabasePool({ connectionString: databaseUrl, max: 1 })
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`)

  const scopedUrl = new URL(databaseUrl)
  scopedUrl.searchParams.set('options', `-c search_path=${schemaName},public`)
  const scopedDatabasePool = createDatabasePool({
    connectionString: scopedUrl.toString(),
    max: 2,
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

  await scopedDatabasePool.query(
    `INSERT INTO "user" (id, name, email)
     VALUES
       ($1, 'Alice', $2),
       ($3, 'Bob', $4),
       ($5, 'Other user', $6)`,
    [
      fixture.aliceUserId,
      `${randomUUID()}@example.test`,
      fixture.bobUserId,
      `${randomUUID()}@example.test`,
      fixture.otherUserId,
      `${randomUUID()}@example.test`,
    ]
  )
  await scopedDatabasePool.query(
    `INSERT INTO organization (id, name, slug)
     VALUES
       ($1, 'Organization A', $2),
       ($3, 'Organization B', $4)`,
    [
      fixture.organizationAId,
      `organization-a-${randomUUID()}`,
      fixture.organizationBId,
      `organization-b-${randomUUID()}`,
    ]
  )
  await databasePool.query(
    `INSERT INTO member (id, organization_id, user_id, role)
     VALUES
       ($1, $2, $3, 'owner'),
       ($4, $2, $5, 'admin'),
       ($6, $7, $8, 'owner')`,
    [
      `member:${randomUUID()}`,
      fixture.organizationAId,
      fixture.aliceUserId,
      `member:${randomUUID()}`,
      fixture.bobUserId,
      `member:${randomUUID()}`,
      fixture.organizationBId,
      fixture.otherUserId,
    ]
  )
  await databasePool.query(
    `INSERT INTO brands (id, organization_id, name, slug, website_url)
     VALUES
       ($1, $2, 'Brand A', 'brand-a', 'https://a.example.test'),
       ($3, $4, 'Brand B', 'brand-b', 'https://b.example.test')`,
    [
      fixture.brandAId,
      fixture.organizationAId,
      fixture.brandBId,
      fixture.organizationBId,
    ]
  )
  await databasePool.query(
    `INSERT INTO actors (id, type, actor_key, user_id)
     VALUES
       ($1, 'human', $2, $3),
       ($4, 'human', $5, $6),
       ($7, 'human', $8, $9)`,
    [
      fixture.aliceActorId,
      `human:${fixture.aliceUserId}`,
      fixture.aliceUserId,
      fixture.bobActorId,
      `human:${fixture.bobUserId}`,
      fixture.bobUserId,
      fixture.otherUserActorId,
      `human:${fixture.otherUserId}`,
      fixture.otherUserId,
    ]
  )
})

beforeEach(async () => {
  await requireDatabasePool().query(
    `UPDATE member SET role = 'owner'
     WHERE organization_id = $1 AND user_id = $2`,
    [fixture.organizationAId, fixture.aliceUserId]
  )
})

afterAll(async () => {
  await databasePool?.end()
  if (adminPool !== undefined) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await adminPool.end()
  }
})

describe('CMO conversations on PostgreSQL', () => {
  it('binds one root session, checkpoints monotonically, and excludes child events', async () => {
    const created = await createCmoConversation({
      access: aliceAccess(),
      database: requireDatabase(),
      input: { title: 'Launch planning' },
    })
    expect(created.session).toEqual({ kind: 'unbound', streamIndex: 0 })

    const firstBinding = await bindCmoSession({
      access: aliceAccess(),
      database: requireDatabase(),
      input: {
        conversationId: created.id,
        parentSessionId: null,
        sessionId: 'session-root-a',
        source: 'root-hook',
      },
    })
    expect(firstBinding.outcome).toBe('bound')
    await expect(
      bindCmoSession({
        access: aliceAccess(),
        database: requireDatabase(),
        input: {
          conversationId: created.id,
          sessionId: 'session-root-a',
          source: 'proxy-create-response',
        },
      })
    ).resolves.toMatchObject({ outcome: 'matched' })
    await expect(
      bindCmoSession({
        access: aliceAccess(),
        database: requireDatabase(),
        input: {
          conversationId: created.id,
          sessionId: 'session-other',
          source: 'proxy-create-response',
        },
      })
    ).rejects.toMatchObject({
      code: 'completion_conflict',
    } satisfies Partial<BrainError>)

    await checkpointCmoConversation({
      access: aliceAccess(),
      database: requireDatabase(),
      input: {
        conversationId: created.id,
        sessionId: 'session-root-a',
        streamIndex: 12,
      },
    })
    const checkpointed = await checkpointCmoConversation({
      access: aliceAccess(),
      database: requireDatabase(),
      input: {
        conversationId: created.id,
        sessionId: 'session-root-a',
        streamIndex: 4,
      },
    })
    expect(checkpointed.session).toEqual({
      kind: 'bound',
      sessionId: 'session-root-a',
      streamIndex: 12,
    })

    await requireDatabasePool().query(
      `INSERT INTO session_events (
        meta_id, brand_id, session_id, root_session_id, conversation_id,
        event_kind, event
      ) VALUES ($1, $2, $3, $3, $4, 'message.created', $5::jsonb)`,
      [
        `event:${randomUUID()}`,
        fixture.brandAId,
        'session-root-a',
        created.id,
        JSON.stringify({ message: 'root-visible' }),
      ]
    )
    await requireDatabasePool().query(
      `INSERT INTO session_events (
        meta_id, brand_id, session_id, root_session_id, parent_session_id,
        parent_call_id, conversation_id, event_kind, event
      ) VALUES ($1, $2, $3, $4, $4, 'call-child', $5, 'message.created', $6::jsonb)`,
      [
        `event:${randomUUID()}`,
        fixture.brandAId,
        'session-child-a',
        'session-root-a',
        created.id,
        JSON.stringify({ message: 'child-private' }),
      ]
    )

    const transcript = await readPersistedCmoEvents({
      access: aliceAccess(),
      database: requireDatabase(),
      input: { conversationId: created.id, limit: 10 },
    })
    expect(transcript.events).toHaveLength(1)
    expect(transcript.events[0]?.event).toEqual({ message: 'root-visible' })
    expect(
      await authorizeCmoSession({
        access: aliceAccess(),
        database: requireDatabase(),
        input: {
          conversationId: created.id,
          operation: { kind: 'read', name: 'reconnect' },
          sessionId: 'session-root-a',
        },
      })
    ).toMatchObject({
      authorization: { kind: 'read', name: 'reconnect' },
      streamIndex: 12,
    })
  })

  it('does not expose Alice conversations to Bob in the same organization', async () => {
    const created = await createCmoConversation({
      access: aliceAccess(),
      database: requireDatabase(),
      input: { title: 'Alice only' },
    })

    await expect(
      listCmoConversations({
        access: bobAccess(),
        database: requireDatabase(),
        input: {},
      })
    ).resolves.toMatchObject({ items: [] })
    await expect(
      openCmoConversation({
        access: bobAccess(),
        database: requireDatabase(),
        input: { conversationId: created.id },
      })
    ).rejects.toMatchObject({
      code: 'conversation_not_found',
    } satisfies Partial<BrainError>)
  })

  it('lets a downgraded owner-viewer read and stop only its observed turn', async () => {
    const created = await createCmoConversation({
      access: aliceAccess(),
      database: requireDatabase(),
      input: { title: 'Viewer recovery' },
    })
    await bindCmoSession({
      access: aliceAccess(),
      database: requireDatabase(),
      input: {
        conversationId: created.id,
        sessionId: 'session-viewer',
        source: 'proxy-create-response',
      },
    })
    await requireDatabasePool().query(
      `UPDATE member SET role = 'viewer'
       WHERE organization_id = $1 AND user_id = $2`,
      [fixture.organizationAId, fixture.aliceUserId]
    )

    await expect(
      openCmoConversation({
        access: aliceAccess(),
        database: requireDatabase(),
        input: { conversationId: created.id },
      })
    ).resolves.toMatchObject({ id: created.id })
    await expect(
      authorizeCmoSession({
        access: aliceAccess(),
        database: requireDatabase(),
        input: {
          conversationId: created.id,
          operation: {
            kind: 'cancel',
            turnId: 'turn-observed',
          },
          sessionId: 'session-viewer',
        },
      })
    ).resolves.toMatchObject({
      authorization: { kind: 'cancel', scope: 'exact-observed-turn' },
    })
    await expect(
      authorizeCmoSession({
        access: aliceAccess(),
        database: requireDatabase(),
        input: {
          conversationId: created.id,
          operation: { kind: 'write', name: 'message' },
          sessionId: 'session-viewer',
        },
      })
    ).rejects.toMatchObject({
      code: 'access_denied',
    } satisfies Partial<BrainError>)
    await expect(
      checkpointCmoConversation({
        access: aliceAccess(),
        database: requireDatabase(),
        input: {
          conversationId: created.id,
          sessionId: 'session-viewer',
          streamIndex: 1,
        },
      })
    ).rejects.toMatchObject({
      code: 'access_denied',
    } satisfies Partial<BrainError>)
  })

  it('fails closed when the supplied organization does not own the brand', async () => {
    const otherTenantAccess = accessFor({
      actorId: fixture.otherUserActorId,
      brandId: fixture.brandAId,
      organizationId: fixture.organizationBId,
      role: 'owner',
      userId: fixture.otherUserId,
    })
    await expect(
      listCmoConversations({
        access: otherTenantAccess,
        database: requireDatabase(),
        input: {},
      })
    ).rejects.toMatchObject({
      code: 'access_denied',
    } satisfies Partial<BrainError>)
  })
})
