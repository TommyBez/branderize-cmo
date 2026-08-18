import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = fileURLToPath(new URL('..', import.meta.url))

const agentRoots = [
  'agent-cmo',
  'agent-product-marketer',
  'agent-content',
  'agent-distribution',
  'agent-seo-discovery',
  'agent-lifecycle',
  'agent-growth',
]

const failures = []

const check = (condition, message) => {
  if (!condition) {
    failures.push(message)
  }
}

const readText = (path) => readFileSync(resolve(rootDirectory, path), 'utf8')
const readJson = (path) => JSON.parse(readText(path))

const appManifest = readJson('apps/app/package.json')
const appTurbo = readJson('apps/app/turbo.json')
const e2eBrowserContract = readText('tests/e2e/phase0.spec.ts')
const e2eRunner = readText('scripts/run-e2e.mjs')
const rootManifest = readJson('package.json')
const rootTurbo = readJson('turbo.json')
const webManifest = readJson('apps/web/package.json')
const webPage = readText('apps/web/app/page.tsx')
const webTurbo = readJson('apps/web/turbo.json')
const appVercel = readJson('apps/app/vercel.json')
const appEnvironmentSchema = readText('packages/env/src/schema.ts')
const appBlobAdapter = readText('apps/app/lib/blob.ts')
const appCmoProxy = readText(
  'apps/app/app/api/brands/[brandId]/cmo/[conversationId]/[...evePath]/route.ts'
)
const marketingSkillsManifest = readJson(
  'packages/marketing-skills/package.json'
)
const cleanupWorkflow = readText('.github/workflows/cleanup-neon-preview.yml')
const sourceMapUpload = readText('scripts/upload-posthog-sourcemaps.mjs')

check(
  JSON.stringify(appVercel.regions) === JSON.stringify(['fra1']),
  'apps/app must run in fra1'
)
check(
  JSON.stringify(appVercel.crons) ===
    JSON.stringify([
      {
        path: '/api/internal/cron/dispatch',
        schedule: '* * * * *',
      },
    ]),
  'apps/app must declare exactly one payload-free minute Cron'
)
check(
  appVercel.functions === undefined,
  'apps/app must retain the default 300-second Fluid Compute duration'
)
check(
  appVercel.buildCommand === 'pnpm run db:migrate && pnpm run build' &&
    appManifest.scripts?.['db:migrate'] === 'pnpm --filter @repo/db db:migrate',
  'apps/app must run direct-url migrations before its Vercel build'
)
check(
  appManifest.scripts?.build === 'next build',
  'apps/app must use the default Turbopack build'
)
check(
  appCmoProxy.includes('signal: request.signal'),
  'apps/app must couple the upstream CMO stream to the proxy request lifetime'
)
check(
  appEnvironmentSchema.includes('BLOB_STORE_ID: blobStoreIdSchema') &&
    appBlobAdapter.includes('storeId: appEnvironment.BLOB_STORE_ID'),
  'apps/app must bind Vercel Blob OIDC operations to an explicit store id'
)
check(
  appManifest.scripts?.postbuild ===
    'node ../../scripts/upload-posthog-sourcemaps.mjs',
  'apps/app must upload production source maps from postbuild'
)
check(
  appManifest.dependencies?.['@repo/observability'] === 'workspace:*' &&
    appManifest.dependencies?.['posthog-js'] === '1.409.5' &&
    appManifest.devDependencies?.['@posthog/cli'] === '0.9.2',
  'apps/app must pin the reviewed PostHog runtime and source-map CLI'
)
check(
  appTurbo.extends?.includes('//') &&
    appTurbo.tasks?.build?.inputs?.includes('$TURBO_EXTENDS$') &&
    appTurbo.tasks?.build?.inputs?.includes(
      '$TURBO_ROOT$/scripts/upload-posthog-sourcemaps.mjs'
    ),
  'apps/app build cache must include the production source-map uploader'
)
check(
  [
    'AGENT_CMO_URL',
    'AGENT_CONTENT_URL',
    'AGENT_DISTRIBUTION_URL',
    'AGENT_GROWTH_URL',
    'AGENT_LIFECYCLE_URL',
    'AGENT_PRODUCT_MARKETER_URL',
    'AGENT_SEO_DISCOVERY_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_TRUSTED_ORIGINS',
    'BETTER_AUTH_URL',
    'BLOB_STORE_ID',
    'CMO_BRIDGE_SECRET',
    'CONTEXT_DEV_API_KEY',
    'CRON_SECRET',
    'DATABASE_URL',
    'DISPATCH_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'NEXT_PUBLIC_APP_URL',
  ].every((name) => appTurbo.tasks?.build?.env?.includes(name)) &&
    !appTurbo.tasks?.build?.env?.includes('DIRECT_DATABASE_URL'),
  'apps/app must receive its exact build-time environment in Turbo strict mode'
)
check(
  [
    'NEXT_PUBLIC_POSTHOG_KEY',
    'NODE_ENV',
    'POSTHOG_CLI_API_KEY',
    'POSTHOG_CLI_HOST',
    'POSTHOG_CLI_PROJECT_ID',
    'VERCEL_ENV',
    'VERCEL_GIT_COMMIT_SHA',
  ].every((name) => rootTurbo.tasks?.build?.env?.includes(name)),
  'Turbo must pass every production telemetry build variable explicitly'
)
check(
  webManifest.scripts?.build === 'next build',
  'apps/web must use the default Turbopack build'
)
check(
  webManifest.dependencies?.['@repo/env'] === 'workspace:*' &&
    webPage.includes("from '@repo/env/client'") &&
    !webPage.includes('localhost:3001') &&
    webTurbo.extends?.includes('//') &&
    webTurbo.tasks?.build?.env?.includes('$TURBO_EXTENDS$') &&
    webTurbo.tasks?.build?.env?.includes('NEXT_PUBLIC_APP_URL'),
  'apps/web must validate and receive the canonical application origin'
)
check(
  appManifest.engines?.node === '24.x' && appManifest.engines?.pnpm === '11.x',
  'apps/app must declare Node 24.x and pnpm 11.x'
)
check(
  webManifest.engines?.node === '24.x' && webManifest.engines?.pnpm === '11.x',
  'apps/web must declare Node 24.x and pnpm 11.x'
)

const appNextConfig = readText('apps/app/next.config.ts')
const webNextConfig = readText('apps/web/next.config.ts')
const hasInstantNavigationConfiguration = (source) =>
  source.includes('cacheComponents: true') &&
  source.includes('partialPrefetching: true') &&
  source.includes('instantInsights:') &&
  source.includes("validationLevel: 'warning'") &&
  source.includes('exposeTestingApiInProductionBuild:') &&
  source.includes("process.env.E2E_EXPOSE_NEXT_TESTING_API === '1'")

check(
  !appNextConfig.includes('webpack'),
  'apps/app next.config.ts must not configure Webpack'
)
check(
  hasInstantNavigationConfiguration(appNextConfig),
  'apps/app must enable Cache Components, Partial Prefetching, instant insights, and the guarded E2E testing API'
)
check(
  appNextConfig.includes('productionBrowserSourceMaps: true'),
  'apps/app must emit production browser source maps for guarded upload'
)
check(
  sourceMapUpload.includes("process.env.VERCEL_ENV === 'production'") &&
    sourceMapUpload.includes(
      "const POSTHOG_EU_CLI_HOST = 'https://eu.posthog.com'"
    ) &&
    sourceMapUpload.includes("'sourcemap',\n      'inject'") &&
    sourceMapUpload.includes("'sourcemap',\n      'upload'") &&
    sourceMapUpload.includes("'--delete-after'") &&
    sourceMapUpload.includes("'--release-name'") &&
    sourceMapUpload.includes("'--release-version'") &&
    !sourceMapUpload.includes('NEXT_PUBLIC_POSTHOG_HOST'),
  'source-map upload must be production-only, EU-pinned, and delete uploaded maps'
)
check(
  !webNextConfig.includes('webpack'),
  'apps/web next.config.ts must not configure Webpack'
)
check(
  hasInstantNavigationConfiguration(webNextConfig),
  'apps/web must enable Cache Components, Partial Prefetching, instant insights, and the guarded E2E testing API'
)
check(
  rootManifest.devDependencies?.['@next/playwright'] === '16.3.0' &&
    e2eRunner.includes("E2E_EXPOSE_NEXT_TESTING_API: '1'") &&
    e2eRunner.match(/E2E_EXPOSE_NEXT_TESTING_API/gu)?.length === 1 &&
    e2eBrowserContract.includes("from '@next/playwright'") &&
    (e2eBrowserContract.match(/await instant\(/gu)?.length ?? 0) >= 3 &&
    e2eBrowserContract.includes(
      "test('protected client navigations expose non-tenant shells before streamed data'"
    ) &&
    e2eBrowserContract.includes(
      'await expect(workShell).not.toContainText(brandName)'
    ) &&
    e2eBrowserContract.includes(
      'await expect(contextShell).not.toContainText(ownerName)'
    ),
  'production-artifact E2E must prove instant Cache Components shells with the matching Next Playwright helper'
)
check(
  !webNextConfig.includes("output: 'export'"),
  'apps/web must use native Next.js prerendering instead of static-export mode'
)
check(
  !existsSync(resolve(rootDirectory, 'apps/web/vercel.json')),
  'apps/web must not pin a compute region or declare a Cron'
)
check(
  marketingSkillsManifest.eve?.extension?.source === './extension' &&
    marketingSkillsManifest.eve?.extension?.dist === './dist/extension' &&
    marketingSkillsManifest.scripts?.build === 'eve extension build' &&
    marketingSkillsManifest.scripts?.transit === 'eve extension build',
  'packages/marketing-skills must be a production-built Eve workspace extension'
)
check(
  readText('packages/marketing-skills/extension/extension.ts').trim() ===
    "import { defineExtension } from 'eve/extension'\n\nexport default defineExtension()",
  'Phase 0 marketing-skills must remain an empty extension slot'
)
check(
  cleanupWorkflow.includes('pull_request_target:') &&
    cleanupWorkflow.includes('types: [closed]') &&
    cleanupWorkflow.includes('neondatabase/delete-branch-action@v3') &&
    cleanupWorkflow.includes('scripts/resolve-neon-preview-branch.mjs'),
  'closed pull requests must run the guarded Neon preview cleanup'
)

for (const agentRoot of agentRoots) {
  const rootPath = `apps/${agentRoot}`
  const manifest = readJson(`${rootPath}/package.json`)
  const vercel = readJson(`${rootPath}/vercel.json`)

  check(
    JSON.stringify(vercel.regions) === JSON.stringify(['fra1']),
    `${rootPath} must run in fra1`
  )
  check(
    vercel.crons === undefined,
    `${rootPath} must not declare a Vercel Cron`
  )
  check(
    vercel.env === undefined && vercel.build?.env === undefined,
    `${rootPath} must not embed deployment secrets in vercel.json`
  )
  check(
    manifest.engines?.node === '24.x' && manifest.engines?.pnpm === '11.x',
    `${rootPath} must declare Node 24.x and pnpm 11.x`
  )
  check(
    manifest.scripts?.build ===
      'node ../../scripts/materialize-marketing-skills.mjs && eve build',
    `${rootPath} must materialize marketing skills before eve build`
  )
  check(
    manifest.dependencies?.['@repo/marketing-skills'] === 'workspace:*' &&
      readText(`${rootPath}/agent/extensions/marketing-skills.ts`).trim() ===
        "import marketingSkills from '@repo/marketing-skills'\n\nexport default marketingSkills()",
    `${rootPath} must mount the shared marketing-skills extension`
  )
  check(
    !JSON.stringify({ manifest, vercel }).includes('DIRECT_DATABASE_URL'),
    `${rootPath} must never receive DIRECT_DATABASE_URL`
  )
  check(
    vercel.buildCommand === undefined &&
      manifest.scripts?.['db:migrate'] === undefined,
    `${rootPath} must never run database migrations`
  )
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`deployment contract failed: ${failure}\n`)
  }
  process.exitCode = 1
} else {
  process.stdout.write(
    'deployment contract passed for apps/app, apps/web, and seven agent roots\n'
  )
}
