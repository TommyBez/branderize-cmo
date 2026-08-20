import { describe, expect, it } from 'vitest'
import { parseAgentServerEnvironment, readDispatchSecret } from './agent-server'
import { parseAppServerEnvironment } from './app-server'
import { parseClientEnvironment } from './client'
import { parseCmoAgentServerEnvironment } from './cmo-agent-server'
import { parseMigrationServerEnvironment } from './migration-server'

const validAppEnvironment = {
  AGENT_PRODUCT_MARKETER_URL: 'http://localhost:2001/',
  BETTER_AUTH_SECRET: 'a-high-entropy-secret-with-more-than-32-characters',
  BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000, http://localhost:3001/',
  BETTER_AUTH_URL: 'http://localhost:3001/',
  BLOB_STORE_ID: 'e2estore',
  CMO_BRIDGE_SECRET: 'cmo-bridge-secret-with-more-than-32-characters',
  CRON_SECRET: 'cron-secret-with-more-than-32-characters',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/branderize',
  DISPATCH_SECRET: 'dispatch-secret-with-more-than-32-characters',
  NODE_ENV: 'test',
  RESEND_API_KEY: 're_test_api_key',
  RESEND_FROM_EMAIL: 'access@example.test',
} satisfies Readonly<Record<string, string>>

describe('app server environment', () => {
  it('validates and normalizes explicit trusted origins', () => {
    const environment = parseAppServerEnvironment(validAppEnvironment)

    expect(environment.BETTER_AUTH_URL).toBe('http://localhost:3001')
    expect(environment.BLOB_STORE_ID).toBe('e2estore')
    expect(environment.BETTER_AUTH_TRUSTED_ORIGINS).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
    ])
  })

  it('requires an explicit Blob store identity for OIDC', () => {
    expect(() =>
      parseAppServerEnvironment({
        ...validAppEnvironment,
        BLOB_STORE_ID: '',
      })
    ).toThrow()
  })

  it('rejects weak auth secrets', () => {
    expect(() =>
      parseAppServerEnvironment({
        ...validAppEnvironment,
        BETTER_AUTH_SECRET: 'too-short',
      })
    ).toThrow()
  })

  it('validates the Resend API key and sender mailbox', () => {
    expect(() =>
      parseAppServerEnvironment({
        ...validAppEnvironment,
        RESEND_API_KEY: 'not-a-resend-key',
      })
    ).toThrow()
    expect(() =>
      parseAppServerEnvironment({
        ...validAppEnvironment,
        RESEND_FROM_EMAIL: 'not-an-email',
      })
    ).toThrow()
  })

  it('allows no Resend credentials only for the guarded local OTP mode', () => {
    const environment = parseAppServerEnvironment({
      ...validAppEnvironment,
      AUTH_LOCAL_OTP_BYPASS: '1',
      BETTER_AUTH_URL: 'http://127.0.0.1:3001',
      NODE_ENV: 'development',
      RESEND_API_KEY: undefined,
      RESEND_FROM_EMAIL: undefined,
      VERCEL_ENV: 'development',
    })

    expect(environment.AUTH_LOCAL_OTP_BYPASS).toBe('1')
    expect(environment.RESEND_API_KEY).toBeUndefined()
    expect(environment.RESEND_FROM_EMAIL).toBeUndefined()
  })

  it.each([
    { BETTER_AUTH_URL: 'https://app.example.test' },
    { BETTER_AUTH_URL: 'http://localhost:3001', NODE_ENV: 'test' },
    { BETTER_AUTH_URL: 'http://localhost:3001', VERCEL_ENV: 'preview' },
  ])(
    'rejects local OTP bypass outside guarded local development',
    (override) => {
      expect(() =>
        parseAppServerEnvironment({
          ...validAppEnvironment,
          AUTH_LOCAL_OTP_BYPASS: '1',
          NODE_ENV: 'development',
          RESEND_API_KEY: undefined,
          RESEND_FROM_EMAIL: undefined,
          VERCEL_ENV: 'development',
          ...override,
        })
      ).toThrow('AUTH_LOCAL_OTP_BYPASS requires')
    }
  )

  it('requires Resend credentials when local OTP bypass is absent', () => {
    expect(() =>
      parseAppServerEnvironment({
        ...validAppEnvironment,
        RESEND_API_KEY: undefined,
        RESEND_FROM_EMAIL: undefined,
      })
    ).toThrow('RESEND_API_KEY is required outside local OTP development')
  })

  it('rejects insecure production auth origins', () => {
    expect(() =>
      parseAppServerEnvironment({
        ...validAppEnvironment,
        NODE_ENV: 'production',
      })
    ).toThrow('BETTER_AUTH_URL must use HTTPS in production')
  })
})

describe('deployment-specific database credentials', () => {
  it('rejects a direct database URL in agent deployments', () => {
    expect(() =>
      parseAgentServerEnvironment({
        DATABASE_URL: validAppEnvironment.DATABASE_URL,
        DIRECT_DATABASE_URL:
          'postgresql://postgres:postgres@localhost:5432/branderize',
        DISPATCH_SECRET: validAppEnvironment.DISPATCH_SECRET,
        NODE_ENV: 'test',
      })
    ).toThrow('DIRECT_DATABASE_URL must not be present')
  })

  it('keeps dispatch closed when agent-server configuration is invalid', () => {
    expect(
      readDispatchSecret({
        DATABASE_URL: validAppEnvironment.DATABASE_URL,
        DIRECT_DATABASE_URL:
          'postgresql://postgres:postgres@localhost:5432/branderize',
        DISPATCH_SECRET: validAppEnvironment.DISPATCH_SECRET,
        NODE_ENV: 'test',
      })
    ).toBeUndefined()
    expect(
      readDispatchSecret({
        DATABASE_URL: validAppEnvironment.DATABASE_URL,
        NODE_ENV: 'test',
      })
    ).toBeUndefined()
  })

  it('reads the dispatch secret from a valid agent-server environment', () => {
    expect(
      readDispatchSecret({
        DATABASE_URL: validAppEnvironment.DATABASE_URL,
        DISPATCH_SECRET: validAppEnvironment.DISPATCH_SECRET,
        NODE_ENV: 'test',
      })
    ).toBe(validAppEnvironment.DISPATCH_SECRET)
  })

  it('keeps the human bridge credential exclusive to the CMO parser', () => {
    const cmoEnvironment = parseCmoAgentServerEnvironment({
      AGENT_PRODUCT_MARKETER_URL:
        validAppEnvironment.AGENT_PRODUCT_MARKETER_URL,
      CMO_BRIDGE_SECRET: validAppEnvironment.CMO_BRIDGE_SECRET,
      DATABASE_URL: validAppEnvironment.DATABASE_URL,
      DISPATCH_SECRET: validAppEnvironment.DISPATCH_SECRET,
      NODE_ENV: 'test',
    })
    const specialistEnvironment = parseAgentServerEnvironment({
      CMO_BRIDGE_SECRET: validAppEnvironment.CMO_BRIDGE_SECRET,
      DATABASE_URL: validAppEnvironment.DATABASE_URL,
      DISPATCH_SECRET: validAppEnvironment.DISPATCH_SECRET,
      NODE_ENV: 'test',
    })

    expect(cmoEnvironment.CMO_BRIDGE_SECRET).toBe(
      validAppEnvironment.CMO_BRIDGE_SECRET
    )
    expect(cmoEnvironment.AGENT_PRODUCT_MARKETER_URL).toBe(
      'http://localhost:2001'
    )
    expect('CMO_BRIDGE_SECRET' in specialistEnvironment).toBe(false)
  })

  it('gives the CMO only the Product Marketer endpoint', () => {
    const cmoEnvironment = parseCmoAgentServerEnvironment({
      AGENT_CMO_URL: 'https://cmo.example.test',
      AGENT_CONTENT_URL: 'https://content.example.test',
      AGENT_PRODUCT_MARKETER_URL: 'https://product-marketer.example.test/',
      CMO_BRIDGE_SECRET: validAppEnvironment.CMO_BRIDGE_SECRET,
      DATABASE_URL: validAppEnvironment.DATABASE_URL,
      DISPATCH_SECRET: validAppEnvironment.DISPATCH_SECRET,
      NODE_ENV: 'production',
    })

    expect(cmoEnvironment.AGENT_PRODUCT_MARKETER_URL).toBe(
      'https://product-marketer.example.test'
    )
    expect('AGENT_CMO_URL' in cmoEnvironment).toBe(false)
    expect('AGENT_CONTENT_URL' in cmoEnvironment).toBe(false)
  })

  it('requires the direct URL at the migration boundary', () => {
    expect(() =>
      parseMigrationServerEnvironment({ NODE_ENV: 'test' })
    ).toThrow()
  })
})

describe('client environment', () => {
  it('returns only browser-safe keys', () => {
    const environment = parseClientEnvironment({
      DIRECT_DATABASE_URL:
        'postgresql://postgres:postgres@localhost:5432/branderize',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
    })

    expect(environment).toEqual({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
    })
    expect('DIRECT_DATABASE_URL' in environment).toBe(false)
    expect('RESEND_API_KEY' in environment).toBe(false)
  })

  it.each([
    {},
    { NEXT_PUBLIC_APP_URL: 'not-a-url' },
    { NEXT_PUBLIC_APP_URL: 'ftp://app.example.test' },
    { NEXT_PUBLIC_APP_URL: 'https://app.example.test/path' },
  ])('rejects a missing or non-HTTP application origin', (source) => {
    expect(() => parseClientEnvironment(source)).toThrow()
  })
})
