import {
  type EnvironmentSource,
  migrationServerEnvironmentSchema,
} from './schema'

export type MigrationServerEnvironment = ReturnType<
  typeof migrationServerEnvironmentSchema.parse
>

export const parseMigrationServerEnvironment = (
  source: EnvironmentSource
): MigrationServerEnvironment =>
  migrationServerEnvironmentSchema.parse({
    DIRECT_DATABASE_URL: source.DIRECT_DATABASE_URL,
    NODE_ENV: source.NODE_ENV,
  })
