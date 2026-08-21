import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_NODE_RANGE = '24.x'
const ROOT_PNPM_RANGE = '11.x'
const ROOT_PNPM_VERSION = '11.22.0'
const NODE_MAJOR = '24'
const LOCKFILE_IMPORTER_PATTERN = /^ {2}\S/

const rootDirectory = fileURLToPath(new URL('..', import.meta.url))

const readText = (path) => readFileSync(resolve(rootDirectory, path), 'utf8')
const readJson = (path) => JSON.parse(readText(path))

const readLockfileDependency = ({ dependency, importer, lockfile }) => {
  const lines = lockfile.split('\n')
  const importerStart = lines.indexOf(`  ${importer}:`)

  if (importerStart === -1) {
    return
  }

  const importerEnd = lines.findIndex(
    (line, index) =>
      index > importerStart && LOCKFILE_IMPORTER_PATTERN.test(line)
  )
  const importerLines = lines.slice(
    importerStart,
    importerEnd === -1 ? lines.length : importerEnd
  )
  const dependencyStart = importerLines.indexOf(`      ${dependency}:`)

  if (dependencyStart === -1) {
    return
  }

  const dependencyLines = importerLines.slice(dependencyStart + 1)
  const specifierLine = dependencyLines.find((line) =>
    line.startsWith('        specifier: ')
  )
  const versionLine = dependencyLines.find((line) =>
    line.startsWith('        version: ')
  )

  if (!(specifierLine && versionLine)) {
    return
  }

  return {
    specifier: specifierLine.slice('        specifier: '.length).trim(),
    version: versionLine.slice('        version: '.length).trim().split('(')[0],
  }
}

const failures = []

const check = (condition, message) => {
  if (!condition) {
    failures.push(message)
  }
}

const rootManifest = readJson('package.json')
const nodeVersion = readText('.node-version').trim()
const pnpmUserAgentMatch = /^pnpm\/([^\s]+)/.exec(
  process.env.npm_config_user_agent ?? ''
)
const pnpmVersion =
  pnpmUserAgentMatch?.[1] ??
  execFileSync('corepack', ['pnpm', '--version'], {
    cwd: rootDirectory,
    encoding: 'utf8',
  }).trim()

check(
  rootManifest.engines?.node === ROOT_NODE_RANGE,
  `package.json engines.node must be ${ROOT_NODE_RANGE}`
)
check(
  rootManifest.engines?.pnpm === ROOT_PNPM_RANGE,
  `package.json engines.pnpm must be ${ROOT_PNPM_RANGE}`
)
check(
  rootManifest.packageManager === `pnpm@${ROOT_PNPM_VERSION}`,
  `packageManager must pin pnpm@${ROOT_PNPM_VERSION}`
)
check(nodeVersion === NODE_MAJOR, `.node-version must be ${NODE_MAJOR}`)
check(
  process.versions.node.split('.')[0] === NODE_MAJOR,
  `Node ${NODE_MAJOR}.x is required, received ${process.versions.node}`
)
check(
  pnpmVersion === ROOT_PNPM_VERSION,
  `pnpm ${ROOT_PNPM_VERSION} is required, received ${pnpmVersion}`
)

const ciWorkflow = readText('.github/workflows/ci.yml')
check(
  ciWorkflow.includes('node-version-file: .node-version'),
  'CI must read Node from .node-version'
)
check(
  !ciWorkflow.includes('pnpm check:runtime') &&
    ciWorkflow.includes('run: pnpm check') &&
    ciWorkflow.includes('actions/cache@v4') &&
    ciWorkflow.includes('path: .turbo') &&
    ciWorkflow.includes('vercel/setup-turborepo-remote-cache-action@v1.0.0'),
  'CI must run contract checks through Turbo and cache Turbo artifacts'
)
check(
  ciWorkflow.includes(`corepack prepare pnpm@${ROOT_PNPM_VERSION} --activate`),
  `CI must activate pnpm@${ROOT_PNPM_VERSION} through Corepack`
)
check(ciWorkflow.includes('image: postgres:18'), 'CI must run PostgreSQL 18')
check(
  readText('compose.yaml').includes('image: postgres:18'),
  'Local Compose must run PostgreSQL 18'
)

const pnpmWorkspace = readText('pnpm-workspace.yaml')
check(
  pnpmWorkspace.includes('engineStrict: true'),
  'pnpm-workspace.yaml must enforce engines'
)
check(
  pnpmWorkspace.includes('saveExact: true'),
  'pnpm-workspace.yaml must save exact versions'
)
check(
  pnpmWorkspace.includes('verifyDepsBeforeRun: error'),
  'pnpm-workspace.yaml must reject stale dependencies without an implicit install'
)
check(
  pnpmWorkspace.includes(
    'allowBuilds:\n  "@posthog/cli": true\n  core-js: false\n  esbuild: true'
  ),
  'pnpm-workspace.yaml must approve PostHog CLI and esbuild while explicitly denying core-js scripts'
)

const appManifestPath = 'apps/app/package.json'
const webManifestPath = 'apps/web/package.json'
const cmoManifestPath = 'apps/agent-cmo/package.json'

for (const manifestPath of [appManifestPath, webManifestPath]) {
  const manifest = readJson(manifestPath)
  check(
    manifest.scripts?.build === 'next build',
    `${manifestPath} must use the default Turbopack production build`
  )
}

if (existsSync(resolve(rootDirectory, cmoManifestPath))) {
  const appManifest = readJson(appManifestPath)
  const cmoManifest = readJson(cmoManifestPath)
  const appEve = appManifest.dependencies?.eve
  const cmoEve = cmoManifest.dependencies?.eve
  const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

  check(
    typeof appEve === 'string' && exactVersionPattern.test(appEve),
    'apps/app must pin Eve to an exact version'
  )
  check(
    typeof cmoEve === 'string' && exactVersionPattern.test(cmoEve),
    'apps/agent-cmo must pin Eve to an exact version'
  )
  check(
    appEve === cmoEve,
    'apps/app and apps/agent-cmo must use the same Eve version'
  )

  const lockfile = readText('pnpm-lock.yaml')
  if (typeof appEve === 'string' && typeof cmoEve === 'string') {
    const appLock = readLockfileDependency({
      dependency: 'eve',
      importer: 'apps/app',
      lockfile,
    })
    const cmoLock = readLockfileDependency({
      dependency: 'eve',
      importer: 'apps/agent-cmo',
      lockfile,
    })

    check(
      lockfile.includes(`  eve@${appEve}:`),
      `pnpm-lock.yaml must resolve Eve ${appEve}`
    )
    check(
      appLock?.specifier === appEve && appLock.version === appEve,
      'pnpm-lock.yaml apps/app Eve resolution must match its manifest'
    )
    check(
      cmoLock?.specifier === cmoEve && cmoLock.version === cmoEve,
      'pnpm-lock.yaml apps/agent-cmo Eve resolution must match its manifest'
    )
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`runtime contract failed: ${failure}\n`)
  }
  process.exitCode = 1
} else {
  process.stdout.write(
    `runtime contract passed with Node ${process.versions.node} and pnpm ${pnpmVersion}\n`
  )
}
