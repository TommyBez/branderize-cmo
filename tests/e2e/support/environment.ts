const APP_ORIGIN_FALLBACK = 'http://127.0.0.1:3001'
const CMO_ORIGIN_FALLBACK = 'http://127.0.0.1:2000'
const CONTENT_ORIGIN_FALLBACK = 'http://127.0.0.1:2002'
const DISTRIBUTION_ORIGIN_FALLBACK = 'http://127.0.0.1:2003'
const GROWTH_ORIGIN_FALLBACK = 'http://127.0.0.1:2004'
const LIFECYCLE_ORIGIN_FALLBACK = 'http://127.0.0.1:2005'
const PRODUCT_MARKETER_ORIGIN_FALLBACK = 'http://127.0.0.1:2001'
const SEO_DISCOVERY_ORIGIN_FALLBACK = 'http://127.0.0.1:2006'
const WEB_ORIGIN_FALLBACK = 'http://127.0.0.1:3000'

const requiredEnvironmentValue = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required by the Phase 0 browser suite`)
  }
  return value
}

export const appOrigin = process.env.E2E_APP_ORIGIN ?? APP_ORIGIN_FALLBACK
export const cronSecret = requiredEnvironmentValue('E2E_CRON_SECRET')
export const databaseUrl = requiredEnvironmentValue('DATABASE_URL')
export const functionalAgentOrigins = {
  cmo: process.env.E2E_CMO_ORIGIN ?? CMO_ORIGIN_FALLBACK,
  'product-marketer':
    process.env.E2E_PRODUCT_MARKETER_ORIGIN ?? PRODUCT_MARKETER_ORIGIN_FALLBACK,
} as const
export const healthOnlyAgentOrigins = {
  content: process.env.E2E_CONTENT_ORIGIN ?? CONTENT_ORIGIN_FALLBACK,
  distribution:
    process.env.E2E_DISTRIBUTION_ORIGIN ?? DISTRIBUTION_ORIGIN_FALLBACK,
  growth: process.env.E2E_GROWTH_ORIGIN ?? GROWTH_ORIGIN_FALLBACK,
  lifecycle: process.env.E2E_LIFECYCLE_ORIGIN ?? LIFECYCLE_ORIGIN_FALLBACK,
  'seo-discovery':
    process.env.E2E_SEO_DISCOVERY_ORIGIN ?? SEO_DISCOVERY_ORIGIN_FALLBACK,
} as const
export const providerStateDirectory = requiredEnvironmentValue(
  'E2E_PROVIDER_STATE_DIRECTORY'
)
export const testAuthSecret = requiredEnvironmentValue('BETTER_AUTH_SECRET')
export const webOrigin = process.env.E2E_WEB_ORIGIN ?? WEB_ORIGIN_FALLBACK
