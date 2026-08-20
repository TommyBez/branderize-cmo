import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const CONSOLE_FILES = [
  'apps/app/app/brands/[brandId]/approvals/page.tsx',
  'apps/app/app/brands/[brandId]/connections/page.tsx',
  'apps/app/app/brands/[brandId]/today/page.tsx',
  'apps/app/app/brands/[brandId]/work/page.tsx',
  'apps/app/app/brands/[brandId]/work/[taskId]/page.tsx',
  'apps/app/components/commitment-action-form.tsx',
  'apps/app/components/connection-slot-form.tsx',
  'apps/app/lib/actions.ts',
] as const

const FORBIDDEN = [
  'Approve all',
  'Approve All',
  'target_busy',
  'propose_intent',
  'editTask',
] as const

const TOKEN_LIKE =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret|sk_live|re_[A-Za-z0-9]{16,}/iu
const TARGET_BUSY = /target[_-]?busy/iu

describe('Phase 1 console guards', () => {
  it('does not ship Approve all, target_busy UI, a CMO propose tool, or editTask', async () => {
    const sources = await Promise.all(
      CONSOLE_FILES.map(async (path) => ({
        path,
        source: await readFile(
          new URL(`../../../${path}`, import.meta.url),
          'utf8'
        ),
      }))
    )

    for (const file of sources) {
      for (const fragment of FORBIDDEN) {
        if (fragment === 'target_busy') {
          expect(file.source).not.toContain('blockingTaskId')
          expect(file.source).not.toMatch(TARGET_BUSY)
          continue
        }
        expect(
          file.source,
          `${file.path} must not contain ${fragment}`
        ).not.toContain(fragment)
      }
      expect(
        file.source,
        `${file.path} must not render token-shaped values`
      ).not.toMatch(TOKEN_LIKE)
    }
  })
})
