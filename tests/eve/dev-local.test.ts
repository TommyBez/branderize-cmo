import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  createLocalServiceEnvironment,
  LOCAL_AGENT_ORIGINS,
  LOCAL_DEV_SERVICES,
  localEnvironmentProblems,
  REQUIRED_LOCAL_ENVIRONMENT_KEYS,
} from '../../scripts/dev-local.mjs'

const SECRET_VALUE = 'local-secret-value-with-32-characters'
const FORBIDDEN_LOCAL_COMMAND_PATTERN =
  /\b(?:docker|compose|drizzle|migrat(?:e|ion)s?)\b/iu
const DEV_LOCAL_SCRIPT =
  '"dev:local": "node --env-file-if-exists=apps/app/.env.local scripts/dev-local.mjs"'

const validEnvironment = {
  BETTER_AUTH_SECRET: SECRET_VALUE,
  BLOB_STORE_ID: 'store_development',
  CMO_BRIDGE_SECRET: SECRET_VALUE,
  CONTEXT_DEV_API_KEY: 'context-development-key',
  CRON_SECRET: SECRET_VALUE,
  DATABASE_URL:
    'postgresql://development:password@development-pooler.example.test/branderize',
  DIRECT_DATABASE_URL:
    'postgresql://development:password@development.example.test/branderize',
  DISPATCH_SECRET: SECRET_VALUE,
  VERCEL_OIDC_TOKEN: 'development-oidc-token',
}

const requireService = (name: string) => {
  const service = LOCAL_DEV_SERVICES.find(
    (candidate) => candidate.name === name
  )
  if (service === undefined) {
    throw new Error(`Missing local service ${name}`)
  }
  return service
}

describe('local manual development', () => {
  it('assigns one fixed port to each web surface and Eve root', () => {
    const ports = LOCAL_DEV_SERVICES.map((service) => service.port)

    expect(ports).toEqual([
      2000, 2001, 2002, 2003, 2004, 2005, 2006, 3000, 3001,
    ])
    expect(new Set(ports).size).toBe(LOCAL_DEV_SERVICES.length)
    expect(Object.values(LOCAL_AGENT_ORIGINS)).toEqual([
      'http://127.0.0.1:2000',
      'http://127.0.0.1:2002',
      'http://127.0.0.1:2003',
      'http://127.0.0.1:2004',
      'http://127.0.0.1:2005',
      'http://127.0.0.1:2001',
      'http://127.0.0.1:2006',
    ])
  })

  it('contains no Docker or migration command in the supervisor', async () => {
    const [source, packageManifestSource] = await Promise.all([
      readFile(
        fileURLToPath(new URL('../../scripts/dev-local.mjs', import.meta.url)),
        'utf8'
      ),
      readFile(
        fileURLToPath(new URL('../../package.json', import.meta.url)),
        'utf8'
      ),
    ])
    const commands = LOCAL_DEV_SERVICES.flatMap((service) => [
      service.command,
      ...service.args,
    ]).join(' ')

    expect(source).not.toMatch(FORBIDDEN_LOCAL_COMMAND_PATTERN)
    expect(commands).not.toMatch(FORBIDDEN_LOCAL_COMMAND_PATTERN)
    expect(packageManifestSource).toContain(DEV_LOCAL_SCRIPT)
    for (const service of LOCAL_DEV_SERVICES.filter(
      (candidate) => candidate.kind === 'agent'
    )) {
      expect(service.args).toContain('--no-ui')
      expect(service.args).toContain(String(service.port))
    }
  })

  it('fails before startup when a required external handle is absent', () => {
    const missingEnvironment = {
      ...validEnvironment,
      VERCEL_OIDC_TOKEN: undefined,
    }

    const problems = localEnvironmentProblems(missingEnvironment)

    expect(REQUIRED_LOCAL_ENVIRONMENT_KEYS).toContain('DATABASE_URL')
    expect(REQUIRED_LOCAL_ENVIRONMENT_KEYS).not.toContain('RESEND_API_KEY')
    expect(REQUIRED_LOCAL_ENVIRONMENT_KEYS).not.toContain('RESEND_FROM_EMAIL')
    expect(REQUIRED_LOCAL_ENVIRONMENT_KEYS).toContain('VERCEL_OIDC_TOKEN')
    expect(problems).toEqual(['missing VERCEL_OIDC_TOKEN'])
    expect(problems.join(' ')).not.toContain(SECRET_VALUE)
  })

  it('keeps app secrets out of web and agent child environments', () => {
    const appEnvironment = createLocalServiceEnvironment(
      requireService('app'),
      validEnvironment
    )
    const webEnvironment = createLocalServiceEnvironment(
      requireService('web'),
      validEnvironment
    )
    const cmoEnvironment = createLocalServiceEnvironment(
      requireService('cmo'),
      validEnvironment
    )
    const productMarketerEnvironment = createLocalServiceEnvironment(
      requireService('product-marketer'),
      validEnvironment
    )

    expect(appEnvironment).toMatchObject({
      ...LOCAL_AGENT_ORIGINS,
      AUTH_LOCAL_OTP_BYPASS: '1',
      BETTER_AUTH_TRUSTED_ORIGINS:
        'http://localhost:3000,http://localhost:3001',
      BETTER_AUTH_URL: 'http://localhost:3001',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
      NODE_ENV: 'development',
      VERCEL_ENV: 'development',
    })
    expect(appEnvironment).not.toHaveProperty('RESEND_API_KEY')
    expect(appEnvironment).not.toHaveProperty('RESEND_FROM_EMAIL')
    expect(webEnvironment).toMatchObject({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
      NODE_ENV: 'development',
      VERCEL_ENV: 'development',
    })
    expect(webEnvironment).not.toHaveProperty('DATABASE_URL')
    expect(webEnvironment).not.toHaveProperty('RESEND_API_KEY')
    expect(webEnvironment).not.toHaveProperty('VERCEL_OIDC_TOKEN')

    expect(cmoEnvironment).toMatchObject({
      AGENT_PRODUCT_MARKETER_URL: 'http://127.0.0.1:2001',
      CMO_BRIDGE_SECRET: SECRET_VALUE,
      DATABASE_URL: validEnvironment.DATABASE_URL,
      DISPATCH_SECRET: SECRET_VALUE,
      VERCEL_OIDC_TOKEN: validEnvironment.VERCEL_OIDC_TOKEN,
    })
    expect(cmoEnvironment).not.toHaveProperty('DIRECT_DATABASE_URL')
    expect(cmoEnvironment).not.toHaveProperty('RESEND_API_KEY')
    expect(cmoEnvironment).not.toHaveProperty('AGENT_CMO_URL')

    expect(productMarketerEnvironment).toMatchObject({
      DATABASE_URL: validEnvironment.DATABASE_URL,
      DISPATCH_SECRET: SECRET_VALUE,
      VERCEL_OIDC_TOKEN: validEnvironment.VERCEL_OIDC_TOKEN,
    })
    expect(productMarketerEnvironment).not.toHaveProperty('DIRECT_DATABASE_URL')
    expect(productMarketerEnvironment).not.toHaveProperty('CMO_BRIDGE_SECRET')
    expect(productMarketerEnvironment).not.toHaveProperty('RESEND_API_KEY')
  })
})
