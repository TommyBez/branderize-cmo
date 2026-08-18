import { defineConfig } from 'vitest/config'

const REPORT_TARGET_PATTERN = /^(?:apps|packages|tests)\//
const isCi = process.env.CI === 'true'
const isIntegrationSuite = process.env.VITEST_SUITE === 'integration'
const reportTarget =
  process.argv.find((argument) => REPORT_TARGET_PATTERN.test(argument)) ??
  'workspace-root'
const reportOwner = reportTarget
  .replaceAll(/[^a-zA-Z0-9._-]/g, '-')
  .replaceAll(/^-+|-+$/g, '')
const reportSuite = isIntegrationSuite ? 'integration' : 'unit'

const commonExcludes = [
  '**/node_modules/**',
  '**/.next/**',
  '**/.eve/**',
  '**/.output/**',
  '**/dist/**',
  '**/tests/e2e/**',
  '**/*.e2e.{test,spec}.{ts,tsx}',
]

const unitIncludes = [
  'apps/**/*.{test,spec}.{ts,tsx}',
  'packages/**/*.{test,spec}.{ts,tsx}',
  'tests/eve/**/*.{test,spec}.{ts,tsx}',
]

const integrationIncludes = [
  'apps/**/*.integration.{test,spec}.{ts,tsx}',
  'packages/**/*.integration.{test,spec}.{ts,tsx}',
  'tests/integration/**/*.{test,spec}.{ts,tsx}',
]

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'node',
    exclude: isIntegrationSuite
      ? commonExcludes
      : [...commonExcludes, '**/*.integration.{test,spec}.{ts,tsx}'],
    include: isIntegrationSuite ? integrationIncludes : unitIncludes,
    outputFile: isCi
      ? {
          junit: `test-results/vitest/${reportOwner}-${reportSuite}.xml`,
        }
      : undefined,
    passWithNoTests: true,
    reporters: isCi ? ['default', 'junit'] : ['default'],
    restoreMocks: true,
  },
})
