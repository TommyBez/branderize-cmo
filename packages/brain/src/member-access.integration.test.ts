import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { member, organization, user } from '@repo/db/schema/auth'
import { actors, brands } from '@repo/db/schema/domain'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { materializeTrustedMemberAccess } from './member-access'
import { getBrandProjection } from './projections'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const CONCURRENT_FIRST_ACCESS_COUNT = 4
const schemaName = `brain_member_access_${randomUUID().replaceAll('-', '_')}`

const fixture = {
  bobUserId: `bob:${randomUUID()}`,
  brandAId: randomUUID(),
  brandBId: randomUUID(),
  crossTenantUserId: `cross-tenant:${randomUUID()}`,
  noMemberUserId: `no-member:${randomUUID()}`,
  organizationAId: `organization-a:${randomUUID()}`,
  organizationBId: `organization-b:${randomUUID()}`,
}

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The member access integration database is unavailable')
  }
  return database
}

const actorCount = async (userId: string): Promise<number> => {
  const [row] = await requireDatabase()
    .select({ total: count() })
    .from(actors)
    .where(eq(actors.userId, userId))
  if (row === undefined) {
    throw new Error('The Human Actor count query returned no row')
  }
  return row.total
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for brain integration tests')
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
    new URL('../../db/drizzle/0000_phase0_foundation.sql', import.meta.url),
    'utf8'
  )
  const statements = migration
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
  for (const statement of statements) {
    // biome-ignore lint/performance/noAwaitInLoops: Migration order is part of the integration contract.
    await databasePool.query(statement)
  }

  await requireDatabase()
    .insert(user)
    .values([
      {
        email: `${randomUUID()}@example.test`,
        id: fixture.bobUserId,
        name: 'Bob',
      },
      {
        email: `${randomUUID()}@example.test`,
        id: fixture.crossTenantUserId,
        name: 'Cross tenant member',
      },
      {
        email: `${randomUUID()}@example.test`,
        id: fixture.noMemberUserId,
        name: 'No membership user',
      },
    ])
  await requireDatabase()
    .insert(organization)
    .values([
      {
        id: fixture.organizationAId,
        name: 'Organization A',
        slug: `organization-a-${randomUUID()}`,
      },
      {
        id: fixture.organizationBId,
        name: 'Organization B',
        slug: `organization-b-${randomUUID()}`,
      },
    ])
  await requireDatabase()
    .insert(member)
    .values([
      {
        id: `member:${randomUUID()}`,
        organizationId: fixture.organizationAId,
        role: 'admin',
        userId: fixture.bobUserId,
      },
      {
        id: `member:${randomUUID()}`,
        organizationId: fixture.organizationAId,
        role: 'member',
        userId: fixture.crossTenantUserId,
      },
    ])
  await requireDatabase()
    .insert(brands)
    .values([
      {
        id: fixture.brandAId,
        name: 'Brand A',
        organizationId: fixture.organizationAId,
        slug: `brand-a-${randomUUID()}`,
        websiteUrl: 'https://a.example.test',
      },
      {
        id: fixture.brandBId,
        name: 'Brand B',
        organizationId: fixture.organizationBId,
        slug: `brand-b-${randomUUID()}`,
        websiteUrl: 'https://b.example.test',
      },
    ])
})

afterAll(async () => {
  await databasePool?.end()
  if (adminPool !== undefined) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await adminPool.end()
  }
})

describe('trusted Member access materialization on PostgreSQL', () => {
  it('converges concurrent first access and lets an invited same-organization Member read', async () => {
    const results = await Promise.all(
      Array.from(
        { length: CONCURRENT_FIRST_ACCESS_COUNT },
        async () =>
          await materializeTrustedMemberAccess({
            brandId: fixture.brandAId,
            database: requireDatabase(),
            userId: fixture.bobUserId,
          })
      )
    )
    const accesses = results.map((result) => {
      expect(result.kind).toBe('allowed')
      if (result.kind !== 'allowed') {
        throw new Error('The exact current Member should be allowed')
      }
      return result.access
    })
    const [firstAccess] = accesses
    if (firstAccess === undefined) {
      throw new Error('Expected at least one materialized Member access')
    }

    expect(new Set(accesses.map((access) => access.humanActorId)).size).toBe(1)
    expect(await actorCount(fixture.bobUserId)).toBe(1)
    await expect(
      getBrandProjection({ access: firstAccess, database: requireDatabase() })
    ).resolves.toMatchObject({
      id: fixture.brandAId,
      memberRole: 'admin',
      organizationId: fixture.organizationAId,
    })
  })

  it('denies cross-tenant access before creating a Human Actor', async () => {
    await expect(
      materializeTrustedMemberAccess({
        brandId: fixture.brandBId,
        database: requireDatabase(),
        userId: fixture.crossTenantUserId,
      })
    ).resolves.toEqual({ kind: 'denied' })
    expect(await actorCount(fixture.crossTenantUserId)).toBe(0)
  })

  it('denies a user without current membership before creating a Human Actor', async () => {
    await expect(
      materializeTrustedMemberAccess({
        brandId: fixture.brandAId,
        database: requireDatabase(),
        userId: fixture.noMemberUserId,
      })
    ).resolves.toEqual({ kind: 'denied' })
    expect(await actorCount(fixture.noMemberUserId)).toBe(0)
  })
})
