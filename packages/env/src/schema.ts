import { z } from 'zod'
import { isGuardedLocalEmailOtpEnvironment } from './local-email-otp'

export type EnvironmentSource = Readonly<Record<string, string | undefined>>

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production'])
const vercelEnvironmentSchema = z.enum(['development', 'preview', 'production'])
const secretSchema = z.string().min(32)
const blobStoreIdSchema = z.string().trim().min(1).max(512)
const resendApiKeySchema = z.string().trim().min(4).startsWith('re_')

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
    AUTH_LOCAL_OTP_BYPASS: z.literal('1').optional(),
    BETTER_AUTH_SECRET: secretSchema,
    BETTER_AUTH_TRUSTED_ORIGINS: trustedOriginsSchema,
    BETTER_AUTH_URL: originSchema,
    BLOB_STORE_ID: blobStoreIdSchema,
    CMO_BRIDGE_SECRET: secretSchema,
    CRON_SECRET: secretSchema,
    DATABASE_URL: postgresUrlSchema,
    DISPATCH_SECRET: secretSchema,
    NODE_ENV: nodeEnvironmentSchema,
    RESEND_API_KEY: resendApiKeySchema.optional(),
    RESEND_FROM_EMAIL: z.email().optional(),
    VERCEL_ENV: vercelEnvironmentSchema.optional(),
  })
  .strict()
  .superRefine((environment, context) => {
    const authUrl = new URL(environment.BETTER_AUTH_URL)
    const localOtpBypassIsValid = isGuardedLocalEmailOtpEnvironment(environment)

    if (environment.AUTH_LOCAL_OTP_BYPASS === '1' && !localOtpBypassIsValid) {
      context.addIssue({
        code: 'custom',
        message:
          'AUTH_LOCAL_OTP_BYPASS requires NODE_ENV=development, VERCEL_ENV=development, and a loopback HTTP BETTER_AUTH_URL',
        path: ['AUTH_LOCAL_OTP_BYPASS'],
      })
    }

    if (environment.AUTH_LOCAL_OTP_BYPASS !== '1') {
      if (environment.RESEND_API_KEY === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'RESEND_API_KEY is required outside local OTP development',
          path: ['RESEND_API_KEY'],
        })
      }
      if (environment.RESEND_FROM_EMAIL === undefined) {
        context.addIssue({
          code: 'custom',
          message:
            'RESEND_FROM_EMAIL is required outside local OTP development',
          path: ['RESEND_FROM_EMAIL'],
        })
      }
    }

    if (environment.NODE_ENV !== 'production') {
      return
    }

    const authUrlUsesHttps = authUrl.protocol === 'https:'
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
