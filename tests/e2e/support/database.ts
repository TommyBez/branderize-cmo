import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authSchema } from '../../../packages/db/src/schema/auth'
import { databaseUrl } from './environment'

const requireFromDatabasePackage = createRequire(
  resolve(
    fileURLToPath(new URL('../../../packages/db/package.json', import.meta.url))
  )
)
const {
  drizzle,
}: Pick<
  typeof import('../../../packages/db/node_modules/drizzle-orm/node-postgres'),
  'drizzle'
> = requireFromDatabasePackage('drizzle-orm/node-postgres')
const {
  Pool,
}: Pick<typeof import('../../../packages/db/node_modules/@types/pg'), 'Pool'> =
  requireFromDatabasePackage('pg')

export const databasePool = new Pool({
  allowExitOnIdle: true,
  connectionString: databaseUrl,
  max: 4,
})

export const authTestDatabase = drizzle({
  client: databasePool,
  schema: authSchema,
})

export interface TestDataRegistry {
  readonly organizationIds: Set<string>
  readonly organizationSlugs: Set<string>
  readonly userEmails: Set<string>
  readonly userIds: Set<string>
}

export const createTestDataRegistry = (): TestDataRegistry => ({
  organizationIds: new Set(),
  organizationSlugs: new Set(),
  userEmails: new Set(),
  userIds: new Set(),
})

export const cleanTestData = async (
  registry: TestDataRegistry
): Promise<void> => {
  const client = await databasePool.connect()
  try {
    await client.query('BEGIN')
    if (
      registry.organizationIds.size > 0 ||
      registry.organizationSlugs.size > 0
    ) {
      await client.query(
        `DELETE FROM organization
         WHERE id = ANY($1::text[]) OR slug = ANY($2::text[])`,
        [[...registry.organizationIds], [...registry.organizationSlugs]]
      )
    }
    if (registry.userIds.size > 0 || registry.userEmails.size > 0) {
      const userIds = [...registry.userIds]
      const userEmails = [...registry.userEmails]
      await client.query(
        `DELETE FROM actors
         WHERE user_id IN (
           SELECT id FROM "user"
           WHERE id = ANY($1::text[]) OR email = ANY($2::text[])
         )`,
        [userIds, userEmails]
      )
      await client.query(
        `DELETE FROM "user"
         WHERE id = ANY($1::text[]) OR email = ANY($2::text[])`,
        [userIds, userEmails]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const closeTestDatabase = async (): Promise<void> => {
  await databasePool.end()
}
