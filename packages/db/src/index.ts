// biome-ignore lint/performance/noBarrelFile: This is the intentional public package entry point.
export {
  createDatabase,
  createDatabasePool,
  type Database,
  type DatabasePoolOptions,
  db,
  pool,
} from './client'
