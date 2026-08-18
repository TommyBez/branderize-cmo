import { z } from 'zod'

export type EnvironmentSource = Readonly<Record<string, string | undefined>>

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production'])
const secretSchema = z.string().min(32)
const blobStoreIdSchema = z.string().trim().min(1).max(512)

const postgresUrlSchema = z.url().refine(
  (value) => {
    const { protocol } = new URL(value)
    return protocol === 'postgres:' || protocol === 'postgresql:'
  },
  { error: 'Expected a PostgreSQL connection URL' }
)

const originSchema = z
  .url()
  .refine(
    (value) => {
      const url = new URL(value)
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === '' &&
        url.username === '' &&
        url.password === ''
      )
    },
    { error: 'Expected an origin without path, query, hash, or credentials' }
  )
  .transform((value) => new URL(value).origin)

const trustedOriginsSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  )
  .pipe(z.array(originSchema).min(1))
  .transform((origins) => [...new Set(origins)])

export const appServerEnvironmentSchema = z
  .object({
    BETTER_AUTH_SECRET: secretSchema,
    BETTER_AUTH_TRUSTED_ORIGINS: trustedOriginsSchema,
    BETTER_AUTH_URL: originSchema,
    BLOB_STORE_ID: blobStoreIdSchema,
    CMO_BRIDGE_SECRET: secretSchema,
    CRON_SECRET: secretSchema,
    DATABASE_URL: postgresUrlSchema,
    DISPATCH_SECRET: secretSchema,
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    NODE_ENV: nodeEnvironmentSchema,
  })
  .strict()
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') {
      return
    }

    const authUrlUsesHttps =
      new URL(environment.BETTER_AUTH_URL).protocol === 'https:'
    const trustedOriginsUseHttps =
      environment.BETTER_AUTH_TRUSTED_ORIGINS.every(
        (origin) => new URL(origin).protocol === 'https:'
      )

    if (!authUrlUsesHttps) {
      context.addIssue({
        code: 'custom',
        message: 'BETTER_AUTH_URL must use HTTPS in production',
        path: ['BETTER_AUTH_URL'],
      })
    }

    if (!trustedOriginsUseHttps) {
      context.addIssue({
        code: 'custom',
        message: 'Every trusted origin must use HTTPS in production',
        path: ['BETTER_AUTH_TRUSTED_ORIGINS'],
      })
    }
  })

export const agentServerEnvironmentSchema = z
  .object({
    DATABASE_URL: postgresUrlSchema,
    DISPATCH_SECRET: secretSchema,
    NODE_ENV: nodeEnvironmentSchema,
  })
  .strict()

export const cmoAgentServerEnvironmentSchema = agentServerEnvironmentSchema
  .extend({
    AGENT_PRODUCT_MARKETER_URL: originSchema,
    CMO_BRIDGE_SECRET: secretSchema,
  })
  .strict()

export const migrationServerEnvironmentSchema = z
  .object({
    DIRECT_DATABASE_URL: postgresUrlSchema,
    NODE_ENV: nodeEnvironmentSchema,
  })
  .strict()

export const clientEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_APP_URL: originSchema,
  })
  .strict()
