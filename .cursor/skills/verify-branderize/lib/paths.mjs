import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveLocalOrigin } from '../../../../scripts/dev-local.mjs'

export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPOSITORY_ROOT = resolve(SKILL_ROOT, '../../..')
export const EVIDENCE_ROOT = resolve(
  REPOSITORY_ROOT,
  'test-results/verify-branderize'
)
export const RUN_STATE_PATH = resolve(EVIDENCE_ROOT, 'run.json')

export const WEB_ORIGIN = 'http://127.0.0.1:3000'
export const APP_ORIGIN = 'http://127.0.0.1:3001'
export const BROWSER_WEB_ORIGIN = 'http://localhost:3000'
export const BROWSER_APP_ORIGIN = 'http://localhost:3001'

export const fleetWebOrigin = (source) => resolveLocalOrigin('web', source)
export const fleetAppOrigin = (source) => resolveLocalOrigin('app', source)

export const AGENT_ORIGINS = (source) =>
  Object.freeze({
    cmo: resolveLocalOrigin('cmo', source),
    content: resolveLocalOrigin('content', source),
    distribution: resolveLocalOrigin('distribution', source),
    growth: resolveLocalOrigin('growth', source),
    lifecycle: resolveLocalOrigin('lifecycle', source),
    'product-marketer': resolveLocalOrigin('product-marketer', source),
    'seo-discovery': resolveLocalOrigin('seo-discovery', source),
  })

export const WEB_PORT = 3000
export const APP_PORT = 3001
export const AGENT_PORTS = Object.freeze([
  2000, 2001, 2002, 2003, 2004, 2005, 2006,
])

export const LANDING_HEADING = 'The AI CMO you can trust.'
export const SIGN_IN_HEADING = 'You can still see why something was made.'
export const ONBOARDING_HEADING = 'Start with the brand.'
export const INTENT_HEADING = 'The result before the work.'

export const ensureEvidenceRoot = () => {
  mkdirSync(EVIDENCE_ROOT, { recursive: true })
  return EVIDENCE_ROOT
}
