import { authSchema } from '@repo/db/schema/auth'
import type { AppServerEnvironment } from '@repo/env/app-server'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { organizationPluginOptions } from './access-control'

type AuthEnvironment = Pick<
  AppServerEnvironment,
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_TRUSTED_ORIGINS'
  | 'BETTER_AUTH_URL'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
>

type BranderizeDatabase = typeof import('@repo/db').db

export type CreateBranderizeAuthOptions = Readonly<{
  database: BranderizeDatabase
  environment: AuthEnvironment
}>

export const createBranderizeAuth = ({
  database,
  environment,
}: CreateBranderizeAuthOptions) =>
  betterAuth({
    appName: 'Branderize',
    baseURL: environment.BETTER_AUTH_URL,
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: authSchema,
    }),
    emailAndPassword: { enabled: false },
    plugins: [organization(organizationPluginOptions)],
    secret: environment.BETTER_AUTH_SECRET,
    socialProviders: {
      google: {
        clientId: environment.GOOGLE_CLIENT_ID,
        clientSecret: environment.GOOGLE_CLIENT_SECRET,
      },
    },
    trustedOrigins: environment.BETTER_AUTH_TRUSTED_ORIGINS,
    user: { deleteUser: { enabled: false } },
  })
