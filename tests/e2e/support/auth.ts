import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext } from '@playwright/test'
import { authSchema } from '../../../packages/db/src/schema/auth'
import { authTestDatabase } from './database'
import { appOrigin, testAuthSecret } from './environment'

const requireFromAuthPackage = createRequire(
  resolve(
    fileURLToPath(
      new URL('../../../packages/auth/package.json', import.meta.url)
    )
  )
)
const {
  betterAuth,
}: Pick<
  typeof import('../../../packages/auth/node_modules/better-auth'),
  'betterAuth'
> = requireFromAuthPackage('better-auth')
type TestDrizzleAdapter = (
  database: typeof authTestDatabase,
  configuration: {
    readonly provider: 'pg'
    readonly schema: typeof authSchema
  }
) => Parameters<typeof betterAuth>[0]['database']

const { drizzleAdapter }: { readonly drizzleAdapter: TestDrizzleAdapter } =
  requireFromAuthPackage('better-auth/adapters/drizzle')
const {
  parseSetCookieHeader,
}: Pick<
  typeof import('../../../packages/auth/node_modules/better-auth/dist/cookies/index.mjs'),
  'parseSetCookieHeader'
> = requireFromAuthPackage('better-auth/cookies')

const testAuth = betterAuth({
  appName: 'Branderize E2E',
  baseURL: appOrigin,
  database: drizzleAdapter(authTestDatabase, {
    provider: 'pg',
    schema: authSchema,
  }),
  emailAndPassword: { enabled: true },
  secret: testAuthSecret,
  trustedOrigins: [appOrigin],
})

export interface AuthenticatedBrowser {
  readonly context: BrowserContext
  readonly email: string
  readonly name: string
  readonly userId: string
}

export const createAuthenticatedBrowser = async ({
  browser,
  email,
  name,
}: {
  readonly browser: Browser
  readonly email: string
  readonly name: string
}): Promise<AuthenticatedBrowser> => {
  const result = await testAuth.api.signUpEmail({
    body: {
      email,
      name,
      password: 'phase0-e2e-password',
      rememberMe: false,
    },
    returnHeaders: true,
  })
  const setCookie = result.headers?.get('set-cookie')
  if (setCookie === undefined || setCookie === null) {
    throw new Error('Better Auth did not return a session cookie')
  }

  const sessionCookie = parseSetCookieHeader(setCookie).get(
    'better-auth.session_token'
  )
  if (sessionCookie === undefined) {
    throw new Error('Better Auth did not return the expected session token')
  }

  const context = await browser.newContext({ baseURL: appOrigin })
  await context.addCookies([
    {
      httpOnly: true,
      name: 'better-auth.session_token',
      sameSite: 'Lax',
      url: appOrigin,
      value: sessionCookie.value,
    },
  ])

  return {
    context,
    email,
    name,
    userId: result.response.user.id,
  }
}
