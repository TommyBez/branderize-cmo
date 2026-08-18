import { describe, expect, it } from 'vitest'

import { resolveProductionPostHogToken } from './posthog-config'

const productionEnvironment = {
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_12345678',
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
} as const

describe('resolveProductionPostHogToken', () => {
  it('enables only a valid production project token', () => {
    expect(resolveProductionPostHogToken(productionEnvironment)).toBe(
      'phc_12345678'
    )
  })

  it.each([
    { ...productionEnvironment, NODE_ENV: 'development' },
    { ...productionEnvironment, VERCEL_ENV: 'preview' },
    { ...productionEnvironment, NEXT_PUBLIC_POSTHOG_KEY: 'not-a-token' },
    { NODE_ENV: 'production', VERCEL_ENV: 'production' },
  ])('rejects a non-production or invalid configuration', (environment) => {
    expect(resolveProductionPostHogToken(environment)).toBeNull()
  })
})
