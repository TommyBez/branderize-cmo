import { authSchema } from '@repo/db/schema/auth'
import type { AppServerEnvironment } from '@repo/env/app-server'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP, organization } from 'better-auth/plugins'
import { organizationPluginOptions } from './access-control'
import { emailOtpSignInOnlyGuard } from './email-otp-guard'
import { createEmailOtpRuntime } from './email-otp-runtime'

type AuthEnvironment = Pick<
  AppServerEnvironment,
  | 'AUTH_LOCAL_OTP_BYPASS'
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_TRUSTED_ORIGINS'
  | 'BETTER_AUTH_URL'
  | 'NODE_ENV'
  | 'RESEND_API_KEY'
  | 'RESEND_FROM_EMAIL'
  | 'VERCEL_ENV'
>

type BranderizeDatabase = typeof import('@repo/db').db

export type CreateBranderizeAuthOptions = Readonly<{
  database: BranderizeDatabase
  environment: AuthEnvironment
}>

export const createBranderizeAuth = ({
  database,
  environment,
}: CreateBranderizeAuthOptions) => {
  const emailOtpRuntime = createEmailOtpRuntime(environment)

  return betterAuth({
    appName: 'Branderize',
    baseURL: environment.BETTER_AUTH_URL,
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: authSchema,
    }),
    emailAndPassword: { enabled: false },
    hooks: { before: emailOtpSignInOnlyGuard },
    plugins: [
      emailOTP(emailOtpRuntime.options),
      organization(organizationPluginOptions),
    ],
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: environment.BETTER_AUTH_TRUSTED_ORIGINS,
    user: { deleteUser: { enabled: false } },
  })
}
