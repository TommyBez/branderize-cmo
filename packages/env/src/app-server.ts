import { appServerEnvironmentSchema, type EnvironmentSource } from './schema'

export type AppServerEnvironment = ReturnType<
  typeof appServerEnvironmentSchema.parse
>

export const parseAppServerEnvironment = (
  source: EnvironmentSource
): AppServerEnvironment =>
  appServerEnvironmentSchema.parse({
    BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET,
    BETTER_AUTH_TRUSTED_ORIGINS: source.BETTER_AUTH_TRUSTED_ORIGINS,
    BETTER_AUTH_URL: source.BETTER_AUTH_URL,
    BLOB_STORE_ID: source.BLOB_STORE_ID,
    CMO_BRIDGE_SECRET: source.CMO_BRIDGE_SECRET,
    CRON_SECRET: source.CRON_SECRET,
    DATABASE_URL: source.DATABASE_URL,
    DISPATCH_SECRET: source.DISPATCH_SECRET,
    GOOGLE_CLIENT_ID: source.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: source.GOOGLE_CLIENT_SECRET,
    NODE_ENV: source.NODE_ENV,
  })
