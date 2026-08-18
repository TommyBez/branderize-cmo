import { attachDatabasePool } from '@vercel/functions'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { schema } from './schema'

const DEFAULT_CONNECTION_TIMEOUT_MS = 5000
const DEFAULT_IDLE_TIMEOUT_MS = 30_000
const DEFAULT_POOL_SIZE = 10

export interface DatabasePoolOptions {
  connectionString: string
  connectionTimeoutMillis?: number
  idleTimeoutMillis?: number
  max?: number
}

export const createDatabasePool = ({
  connectionString,
  connectionTimeoutMillis = DEFAULT_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis = DEFAULT_IDLE_TIMEOUT_MS,
  max = DEFAULT_POOL_SIZE,
}: DatabasePoolOptions): Pool => {
  if (connectionString.trim().length === 0) {
    throw new Error('A non-empty PostgreSQL connection string is required')
  }

  if (!(Number.isInteger(max) && max > 0)) {
    throw new Error('Database pool max must be a positive integer')
  }

  const databasePool = new Pool({
    allowExitOnIdle: true,
    connectionString,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    max,
  })

  attachDatabasePool(databasePool)

  return databasePool
}

export const createDatabase = (databasePool: Pool) =>
  drizzle({ client: databasePool, schema })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to initialize @repo/db')
}

export const pool = createDatabasePool({ connectionString: databaseUrl })
export const db = createDatabase(pool)
export type Database = typeof db
