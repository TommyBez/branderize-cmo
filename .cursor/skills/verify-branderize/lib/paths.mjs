import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

export const AGENT_ORIGINS = Object.freeze({
  cmo: 'http://127.0.0.1:2000',
  content: 'http://127.0.0.1:2002',
  distribution: 'http://127.0.0.1:2003',
  growth: 'http://127.0.0.1:2004',
  lifecycle: 'http://127.0.0.1:2005',
  'product-marketer': 'http://127.0.0.1:2001',
  'seo-discovery': 'http://127.0.0.1:2006',
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
