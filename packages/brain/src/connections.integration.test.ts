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
  brandConnections,
  brands,
} from '@repo/db/schema/domain'
import { executeStatementsSequentially } from '@repo/db/test-support'
import { and, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  connectBrandConnection,
  disconnectBrandConnection,
  lookupActiveBrandConnection,
  readBrandConnectionCapabilities,
} from './connections'
import type { TrustedMemberAccess } from './context'
import type { BrainError } from './errors'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const TEST_TIMEOUT_MS = 30_000
const NOTION_INSTALLATION_ID = 'inst_test_notion_workspace'
const TYPEFULLY_INSTALLATION_ID = 'inst_test_typefully_account'
const TOKEN_LIKE_PATTERN =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret|sk_live|re_[A-Za-z0-9]{16,}/iu
const schemaName = `brain_connections_${randomUUID().replaceAll('-', '_')}`
const migrationFiles = [
  '0000_phase0_foundation.sql',
  '0001_brand_connections.sql',
] as const

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The brand connection integration database is unavailable')
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
    name: 'Connection owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'Connection organization',
    slug: `connection-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role,
    userId,
  })
  await currentDatabase.insert(brands).values({
    id: brandId,
    name: 'Connection brand',
    organizationId,
    slug: `connection-${unique}`,
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
    throw new Error('The connection action count query returned no row')
  }
  return result.total
}

const readConnectionRow = async (connectionId: string) => {
  const [row] = await requireDatabase()
    .select({
      accountLabel: brandConnections.accountLabel,
      connectorUid: brandConnections.connectorUid,
      installationId: brandConnections.installationId,
      providerSlot: brandConnections.providerSlot,
      scopes: brandConnections.scopes,
      status: brandConnections.status,
    })
    .from(brandConnections)
    .where(eq(brandConnections.id, connectionId))
    .limit(1)
  if (row === undefined) {
    throw new Error('The brand connection row was not found')
  }
  return row
}

const connectSlot = async (
  access: TrustedMemberAccess,
  providerSlot: 'notion' | 'typefully',
  requestId = `connect:${providerSlot}:${randomUUID()}`
) => {
  const installationId =
    providerSlot === 'notion'
      ? NOTION_INSTALLATION_ID
      : TYPEFULLY_INSTALLATION_ID
  const input = {
    accountLabel:
      providerSlot === 'notion'
        ? 'Acme Notion workspace'
        : 'Acme Typefully account',
    connectorUid: `${providerSlot}/branderize-test`,
    installationId,
    providerSlot,
    requestId,
    scopes: providerSlot === 'notion' ? ['read'] : ['drafts'],
  }
  return {
    input,
    receipt: await connectBrandConnection({
      access,
      database: requireDatabase(),
      input,
    }),
  }
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for brand connection tests')
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

describe('brand-owned connections on PostgreSQL', () => {
  it('connects Notion and Typefully slots as reference rows plus Actions', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const notion = await connectSlot(access, 'notion')
    const typefully = await connectSlot(access, 'typefully')

    expect(notion.receipt).toMatchObject({
      installationId: NOTION_INSTALLATION_ID,
      outcome: 'connection_connected',
      providerSlot: 'notion',
    })
    expect(typefully.receipt).toMatchObject({
      installationId: TYPEFULLY_INSTALLATION_ID,
      outcome: 'connection_connected',
      providerSlot: 'typefully',
    })
    expect(await readConnectionRow(notion.receipt.connectionId)).toMatchObject({
      accountLabel: 'Acme Notion workspace',
      installationId: NOTION_INSTALLATION_ID,
      status: 'active',
    })
    expect(
      await countActions({
        brandId: access.brandId,
        type: 'connection_connected',
      })
    ).toBe(2)
    expect(JSON.stringify(notion.receipt)).not.toMatch(TOKEN_LIKE_PATTERN)
    expect(JSON.stringify(typefully.receipt)).not.toMatch(TOKEN_LIKE_PATTERN)

    const [action] = await requireDatabase()
      .select({
        actorId: actions.actorId,
        payload: actions.payload,
      })
      .from(actions)
      .where(
        and(
          eq(actions.brandId, access.brandId),
          eq(actions.id, notion.receipt.actionId)
        )
      )
      .limit(1)
    expect(action?.actorId).toBe(access.humanActorId)
    expect(JSON.stringify(action?.payload)).not.toMatch(TOKEN_LIKE_PATTERN)
  })

  it('replays the same connect request and rejects a second active slot', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const requestId = `connect:notion:${randomUUID()}`
    const first = await connectSlot(access, 'notion', requestId)

    await expect(
      connectBrandConnection({
        access,
        database: requireDatabase(),
        input: first.input,
      })
    ).resolves.toEqual(first.receipt)
    expect(
      await countActions({
        brandId: access.brandId,
        type: 'connection_connected',
      })
    ).toBe(1)

    await expect(
      connectBrandConnection({
        access,
        database: requireDatabase(),
        input: {
          ...first.input,
          requestId: `connect:notion:${randomUUID()}`,
        },
      })
    ).rejects.toMatchObject({
      code: 'operation_conflict',
    } satisfies Partial<BrainError>)
    expect(
      await countActions({
        brandId: access.brandId,
        type: 'connection_connected',
      })
    ).toBe(1)
  })

  it('disconnects the active row and writes a disconnect Action', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const connected = await connectSlot(access, 'typefully')
    const receipt = await disconnectBrandConnection({
      access,
      database: requireDatabase(),
      input: {
        providerSlot: 'typefully',
        requestId: `disconnect:typefully:${randomUUID()}`,
      },
    })

    expect(receipt).toMatchObject({
      connectionId: connected.receipt.connectionId,
      installationId: TYPEFULLY_INSTALLATION_ID,
      outcome: 'connection_disconnected',
    })
    expect(
      await readConnectionRow(connected.receipt.connectionId)
    ).toMatchObject({
      installationId: TYPEFULLY_INSTALLATION_ID,
      status: 'inactive',
    })
    expect(
      await lookupActiveBrandConnection({
        brandId: access.brandId,
        database: requireDatabase(),
        providerSlot: 'typefully',
      })
    ).toBeNull()
    expect(
      await countActions({
        brandId: access.brandId,
        type: 'connection_disconnected',
      })
    ).toBe(1)
    expect(JSON.stringify(receipt)).not.toMatch(TOKEN_LIKE_PATTERN)
  })

  it('returns a missing capability for a disconnected slot without throwing', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const access = await createMemberAccess()
    const empty = await readBrandConnectionCapabilities({
      access,
      database: requireDatabase(),
    })
    expect(empty).toEqual({
      notion: { capabilityKey: 'connection:notion', kind: 'missing' },
      typefully: { capabilityKey: 'connection:typefully', kind: 'missing' },
    })

    await connectSlot(access, 'notion')
    await disconnectBrandConnection({
      access,
      database: requireDatabase(),
      input: {
        providerSlot: 'notion',
        requestId: `disconnect:notion:${randomUUID()}`,
      },
    })
    const snapshot = await readBrandConnectionCapabilities({
      access,
      database: requireDatabase(),
    })
    expect(snapshot.notion).toEqual({
      capabilityKey: 'connection:notion',
      kind: 'missing',
    })
    expect(snapshot.typefully.kind).toBe('missing')
  })
})
