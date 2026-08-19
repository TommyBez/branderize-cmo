import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const DEFAULT_APP_ORIGIN = 'http://127.0.0.1:3001'
const DEFAULT_CMO_ORIGIN = 'http://127.0.0.1:2000'
const DEFAULT_CONTENT_ORIGIN = 'http://127.0.0.1:2002'
const DEFAULT_DISTRIBUTION_ORIGIN = 'http://127.0.0.1:2003'
const DEFAULT_GROWTH_ORIGIN = 'http://127.0.0.1:2004'
const DEFAULT_LIFECYCLE_ORIGIN = 'http://127.0.0.1:2005'
const DEFAULT_PRODUCT_MARKETER_ORIGIN = 'http://127.0.0.1:2001'
const DEFAULT_SEO_DISCOVERY_ORIGIN = 'http://127.0.0.1:2006'
const DEFAULT_WEB_ORIGIN = 'http://127.0.0.1:3000'
const SCRIPTED_PROVIDER_PRELOAD = `--import=${JSON.stringify(
  fileURLToPath(
    new URL('./tests/e2e/preload/scripted-providers.mjs', import.meta.url)
  )
)}`
const providerStateDirectory = process.env.E2E_PROVIDER_STATE_DIRECTORY
if (
  providerStateDirectory === undefined ||
  providerStateDirectory.trim().length === 0
) {
  throw new Error('E2E_PROVIDER_STATE_DIRECTORY is required by Playwright')
}
const agentRuntimeDirectory = (appDirectoryName: string): string =>
  resolve(providerStateDirectory, 'runtime-roots', appDirectoryName)
const eveStartCommand = ({
  appDirectoryName,
  port,
}: {
  readonly appDirectoryName: string
  readonly port: number
}): string => {
  const eveCliPath = fileURLToPath(
    new URL(
      `./apps/${appDirectoryName}/node_modules/eve/bin/eve.js`,
      import.meta.url
    )
  )
  return `node ${SCRIPTED_PROVIDER_PRELOAD} ${JSON.stringify(eveCliPath)} start --host 127.0.0.1 --port ${String(port)}`
}

const appOrigin = process.env.E2E_APP_ORIGIN ?? DEFAULT_APP_ORIGIN
const cmoOrigin = process.env.E2E_CMO_ORIGIN ?? DEFAULT_CMO_ORIGIN
const contentOrigin = process.env.E2E_CONTENT_ORIGIN ?? DEFAULT_CONTENT_ORIGIN
const distributionOrigin =
  process.env.E2E_DISTRIBUTION_ORIGIN ?? DEFAULT_DISTRIBUTION_ORIGIN
const growthOrigin = process.env.E2E_GROWTH_ORIGIN ?? DEFAULT_GROWTH_ORIGIN
const lifecycleOrigin =
  process.env.E2E_LIFECYCLE_ORIGIN ?? DEFAULT_LIFECYCLE_ORIGIN
const productMarketerOrigin =
  process.env.E2E_PRODUCT_MARKETER_ORIGIN ?? DEFAULT_PRODUCT_MARKETER_ORIGIN
const seoDiscoveryOrigin =
  process.env.E2E_SEO_DISCOVERY_ORIGIN ?? DEFAULT_SEO_DISCOVERY_ORIGIN
const webOrigin = process.env.E2E_WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN
const webPort = new URL(webOrigin).port || '3000'
const isCi = process.env.CI === 'true'
const agentEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[0] !== 'DIRECT_DATABASE_URL' &&
      entry[0] !== 'WORKFLOW_LOCAL_DATA_DIR' &&
      entry[1] !== undefined
  )
)

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: isCi,
  fullyParallel: false,
  outputDir: 'test-results/playwright',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: isCi
    ? [
        ['line'],
        ['junit', { outputFile: 'test-results/playwright/results.xml' }],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
      ]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
      ],
  retries: isCi ? 1 : 0,
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  testDir: 'tests/e2e',
  timeout: 60_000,
  updateSnapshots: process.env.E2E_UPDATE_SNAPSHOTS === '1' ? 'all' : 'none',
  use: {
    actionTimeout: 10_000,
    baseURL: appOrigin,
    contextOptions: { reducedMotion: 'reduce' },
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: `pnpm exec next start --hostname 127.0.0.1 --port ${webPort}`,
      cwd: 'apps/web',
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: webOrigin,
    },
    {
      command: `pnpm exec node ${SCRIPTED_PROVIDER_PRELOAD} node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001`,
      cwd: 'apps/app',
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
      url: appOrigin,
    },
    {
      command: eveStartCommand({
        appDirectoryName: 'agent-cmo',
        port: 2000,
      }),
      cwd: agentRuntimeDirectory('agent-cmo'),
      env: agentEnvironment,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 180_000,
      url: `${cmoOrigin}/eve/v1/health`,
    },
    {
      command: eveStartCommand({
        appDirectoryName: 'agent-product-marketer',
        port: 2001,
      }),
      cwd: agentRuntimeDirectory('agent-product-marketer'),
      env: agentEnvironment,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 180_000,
      url: `${productMarketerOrigin}/eve/v1/health`,
    },
    {
      command: eveStartCommand({
        appDirectoryName: 'agent-content',
        port: 2002,
      }),
      cwd: agentRuntimeDirectory('agent-content'),
      env: agentEnvironment,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 180_000,
      url: `${contentOrigin}/eve/v1/health`,
    },
    {
      command: eveStartCommand({
        appDirectoryName: 'agent-distribution',
        port: 2003,
      }),
      cwd: agentRuntimeDirectory('agent-distribution'),
      env: agentEnvironment,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 180_000,
      url: `${distributionOrigin}/eve/v1/health`,
    },
    {
      command: eveStartCommand({
        appDirectoryName: 'agent-growth',
        port: 2004,
      }),
      cwd: agentRuntimeDirectory('agent-growth'),
      env: agentEnvironment,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 180_000,
      url: `${growthOrigin}/eve/v1/health`,
    },
    {
      command: eveStartCommand({
        appDirectoryName: 'agent-lifecycle',
        port: 2005,
      }),
      cwd: agentRuntimeDirectory('agent-lifecycle'),
      env: agentEnvironment,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 180_000,
      url: `${lifecycleOrigin}/eve/v1/health`,
    },
    {
      command: eveStartCommand({
        appDirectoryName: 'agent-seo-discovery',
        port: 2006,
      }),
      cwd: agentRuntimeDirectory('agent-seo-discovery'),
      env: agentEnvironment,
      reuseExistingServer: false,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 180_000,
      url: `${seoDiscoveryOrigin}/eve/v1/health`,
    },
  ],
  workers: 1,
})
