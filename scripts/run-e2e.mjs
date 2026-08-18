import { spawn } from 'node:child_process'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { Client as EveClient } from '../apps/agent-cmo/node_modules/eve/dist/src/client/index.js'

const APP_ORIGIN = 'http://127.0.0.1:3001'
const NEXT_BUILD_APP_ORIGIN = 'https://app.e2e.invalid'
const NEXT_BUILD_WEB_ORIGIN = 'https://web.e2e.invalid'
const HEALTH_ONLY_AGENT_ROOTS = [
  { agent: 'content', appDirectoryName: 'agent-content' },
  { agent: 'distribution', appDirectoryName: 'agent-distribution' },
  { agent: 'growth', appDirectoryName: 'agent-growth' },
  { agent: 'lifecycle', appDirectoryName: 'agent-lifecycle' },
  { agent: 'seo-discovery', appDirectoryName: 'agent-seo-discovery' },
]
const AGENT_APP_DIRECTORIES = [
  'agent-cmo',
  'agent-product-marketer',
  ...HEALTH_ONLY_AGENT_ROOTS.map(({ appDirectoryName }) => appDirectoryName),
]
const NEXT_APPLICATIONS = [
  { directoryName: 'web', packageName: 'web' },
  { directoryName: 'app', packageName: 'app' },
]
const CMO_ORIGIN = 'http://127.0.0.1:2000'
const CONTENT_ORIGIN = 'http://127.0.0.1:2002'
const DISTRIBUTION_ORIGIN = 'http://127.0.0.1:2003'
const GROWTH_ORIGIN = 'http://127.0.0.1:2004'
const LIFECYCLE_ORIGIN = 'http://127.0.0.1:2005'
const SEO_DISCOVERY_ORIGIN = 'http://127.0.0.1:2006'
const COMPOSE_FILE = 'compose.yaml'
const COMPOSE_PROJECT = 'branderize-cmo-e2e'
const DEFAULT_POSTGRES_PORT = '54329'
const EXPECTED_DATABASE_NAME = 'branderize_test'
const E2E_BLOB_TOKEN =
  'vercel_blob_rw_e2estore_scripted-e2e-token-at-least-32-bytes'
const E2E_BLOB_STORE_ID = 'e2estore'
const E2E_CONTEXT_DEV_API_KEY = 'context-dev-scripted-e2e-token'
const GOOGLE_TEST_CLIENT_ID = 'google-e2e-client'
const GOOGLE_TEST_CLIENT_SECRET = 'google-e2e-secret'
const PORT_PATTERN = /^\d{1,5}$/
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATION_EVIDENCE_PATH = resolve(
  REPOSITORY_ROOT,
  'test-results/migration.log'
)
const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"'`]+/giu
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(password|token|secret|api[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu
const ROOT_SMOKE_PROMPT =
  'Branderize Phase 0 E2E root smoke: complete one deterministic turn.'
const SCRIPTED_MODEL_ID = 'deepseek/deepseek-v4-pro-0813'
const SCRIPTED_PROVIDER_PRELOAD = resolve(
  REPOSITORY_ROOT,
  'tests/e2e/preload/scripted-providers.mjs'
)
const TEST_AUTH_SECRET = 'branderize-e2e-auth-secret-at-least-32-bytes'
const TEST_CMO_SECRET = 'branderize-e2e-cmo-secret-at-least-32-bytes'
const TEST_CRON_SECRET = 'branderize-e2e-cron-secret-at-least-32-bytes'
const TEST_DISPATCH_SECRET = 'branderize-e2e-dispatch-secret-at-least-32-bytes'
const PRODUCT_MARKETER_ORIGIN = 'http://127.0.0.1:2001'
const WEB_ORIGIN = 'http://127.0.0.1:3000'
const playwrightArguments = ['test', '--config', 'playwright.config.ts']
if (process.env.E2E_UPDATE_SNAPSHOTS === '1') {
  playwrightArguments.push('--update-snapshots')
}
playwrightArguments.push(...process.argv.slice(2))

const requireFromDatabasePackage = createRequire(
  resolve(REPOSITORY_ROOT, 'packages/db/package.json')
)
const { Client } = requireFromDatabasePackage('pg')

let activeChild
let migrationEvidence = {
  exitCode: null,
  status: 'not-run',
  stderr: '',
  stdout: '',
}
let receivedSignal

const run = ({ args, command, cwd = REPOSITORY_ROOT, env = process.env }) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    activeChild = child

    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      activeChild = undefined
      if (signal) {
        rejectRun(new Error(`${command} stopped after receiving ${signal}`))
        return
      }
      resolveRun(code ?? 1)
    })
  })

const runTurboBuild = async ({ env, filters, label }) => {
  const code = await run({
    args: [
      'exec',
      'turbo',
      'run',
      'build',
      ...filters.map((filter) => `--filter=${filter}`),
    ],
    command: 'pnpm',
    env,
  })
  if (code !== 0) {
    throw new Error(`${label} turbo run build exited with code ${code}`)
  }
}

const runSequentially = async ({ items, operation, position = 0 }) => {
  const item = items.at(position)
  if (item === undefined) {
    return
  }

  await operation(item)
  await runSequentially({ items, operation, position: position + 1 })
}

const redactMigrationOutput = ({ output, sensitiveValues }) => {
  let redactedOutput = output
  for (const sensitiveValue of new Set(sensitiveValues)) {
    if (sensitiveValue.length > 0) {
      redactedOutput = redactedOutput.replaceAll(
        sensitiveValue,
        '[redacted-database-url]'
      )
    }
  }
  return redactedOutput
    .replace(POSTGRES_URL_PATTERN, '[redacted-database-url]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1=[redacted]')
}

const writeVisibleMigrationOutput = ({ stderr, stdout }) => {
  if (stdout.length > 0) {
    process.stdout.write(stdout)
    if (!stdout.endsWith('\n')) {
      process.stdout.write('\n')
    }
  }
  if (stderr.length > 0) {
    process.stderr.write(stderr)
    if (!stderr.endsWith('\n')) {
      process.stderr.write('\n')
    }
  }
}

const migrationStatus = ({ code, signal, spawnError }) => {
  if (spawnError) {
    return 'spawn-error'
  }
  if (signal) {
    return `signal:${signal}`
  }
  return code === 0 ? 'succeeded' : 'failed'
}

const runMigration = ({ args, command, cwd, env, sensitiveValues }) =>
  new Promise((resolveRun, rejectRun) => {
    const stderrChunks = []
    const stdoutChunks = []
    let spawnError
    migrationEvidence = {
      exitCode: null,
      status: 'running',
      stderr: '',
      stdout: '',
    }

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    activeChild = child
    child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)))
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => {
      activeChild = undefined
      const stdout = redactMigrationOutput({
        output: Buffer.concat(stdoutChunks).toString('utf8'),
        sensitiveValues,
      })
      const stderr = redactMigrationOutput({
        output: Buffer.concat(stderrChunks).toString('utf8'),
        sensitiveValues,
      })
      writeVisibleMigrationOutput({ stderr, stdout })

      const status = migrationStatus({ code, signal, spawnError })
      migrationEvidence = { exitCode: code, status, stderr, stdout }

      if (spawnError) {
        rejectRun(spawnError)
        return
      }
      if (signal) {
        rejectRun(new Error(`${command} stopped after receiving ${signal}`))
        return
      }
      resolveRun(code ?? 1)
    })
  })

const persistMigrationEvidence = async ({ sensitiveValues }) => {
  const stdout = migrationEvidence.stdout.trimEnd() || '(no stdout)'
  const stderr = migrationEvidence.stderr.trimEnd() || '(no stderr)'
  const exitCode =
    migrationEvidence.exitCode === null
      ? 'not-available'
      : String(migrationEvidence.exitCode)
  const evidence = [
    'Branderize E2E PostgreSQL 17 migration evidence',
    'command: drizzle-kit migrate --config drizzle.config.ts',
    `status: ${migrationEvidence.status}`,
    `exit-code: ${exitCode}`,
    '',
    '[stdout]',
    stdout,
    '',
    '[stderr]',
    stderr,
    '',
  ].join('\n')
  const fullyRedactedEvidence = redactMigrationOutput({
    output: evidence,
    sensitiveValues,
  })

  if (
    fullyRedactedEvidence !== evidence ||
    evidence.search(POSTGRES_URL_PATTERN) !== -1 ||
    sensitiveValues.some(
      (sensitiveValue) =>
        sensitiveValue.length > 0 && evidence.includes(sensitiveValue)
    )
  ) {
    throw new Error('Migration evidence contains a database connection URL')
  }

  await mkdir(dirname(MIGRATION_EVIDENCE_PATH), { recursive: true })
  await writeFile(MIGRATION_EVIDENCE_PATH, evidence, 'utf8')
}

const reserveLoopbackPort = async () =>
  await new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        rejectPort(new Error('Could not reserve an E2E Eve preflight port'))
        return
      }
      server.close((error) => {
        if (error) {
          rejectPort(error)
          return
        }
        resolvePort(address.port)
      })
    })
  })

const startManagedProcess = async ({ args, command, cwd, env }) => {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
  activeChild = child
  const closed = new Promise((resolveClose) => {
    child.once('close', (code, signal) => {
      resolveClose({ code: code ?? 1, signal })
    })
  })
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('error', rejectSpawn)
    child.once('spawn', resolveSpawn)
  })
  return { child, closed }
}

const stopManagedProcess = async ({ child, closed }) => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
  }
  const gracefulStop = await Promise.race([
    closed.then(() => true),
    delay(10_000, false),
  ])
  if (!gracefulStop && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await closed
  }
  if (activeChild === child) {
    activeChild = undefined
  }
}

const pollEveHealth = async ({
  deadline,
  lastFailure,
  managedProcess,
  origin,
}) => {
  if (Date.now() >= deadline) {
    throw new Error(
      `Timed out waiting for Eve preflight health: ${lastFailure}`
    )
  }
  if (
    managedProcess.child.exitCode !== null ||
    managedProcess.child.signalCode !== null
  ) {
    const exit = await managedProcess.closed
    throw new Error(
      `Eve preflight exited before health (code ${String(exit.code)}, signal ${String(exit.signal)})`
    )
  }

  let nextFailure = lastFailure
  try {
    const response = await fetch(`${origin}/eve/v1/health`, {
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) {
      const health = await response.json()
      if (health?.ok === true && health.status === 'ready') {
        return health
      }
      nextFailure = 'health response was not ready'
    } else {
      nextFailure = `health returned HTTP ${String(response.status)}`
    }
  } catch (error) {
    nextFailure = error instanceof Error ? error.message : String(error)
  }

  await delay(250)
  const health = await pollEveHealth({
    deadline,
    lastFailure: nextFailure,
    managedProcess,
    origin,
  })
  return health
}

const waitForEveHealth = async ({ managedProcess, origin }) => {
  const health = await pollEveHealth({
    deadline: Date.now() + 180_000,
    lastFailure: 'not ready',
    managedProcess,
    origin,
  })
  return health
}

const assertCompletePreflightResult = ({ agent, health, info, result }) => {
  if (
    health.workflowId === undefined ||
    health.workflowId.length === 0 ||
    info.agent?.name !== `agent-${agent}` ||
    info.agent?.model?.id !== SCRIPTED_MODEL_ID ||
    info.agent?.model?.reasoning !== 'high' ||
    result.status !== 'waiting' ||
    typeof result.sessionId !== 'string' ||
    result.sessionId.length === 0
  ) {
    throw new Error(`${agent} Eve preflight did not satisfy its root contract`)
  }
  const eventTypes = result.events.map((event) => event.type)
  if (
    !(
      eventTypes.includes('turn.completed') &&
      eventTypes.includes('session.waiting')
    )
  ) {
    throw new Error(`${agent} Eve preflight did not complete a full turn`)
  }
  return eventTypes
}

const assertContainedSourceSnapshot = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Eve preflight source snapshot must not escape through ${entryPath}`
        )
      }
      if (entry.isDirectory()) {
        await assertContainedSourceSnapshot(entryPath)
      }
    })
  )
}

const preparePreflightRoot = async ({ appDirectoryName, stateDirectory }) => {
  const sourceRoot = resolve(REPOSITORY_ROOT, 'apps', appDirectoryName)
  const preflightRoot = resolve(
    stateDirectory,
    'preflight-roots',
    appDirectoryName
  )
  await mkdir(preflightRoot, { recursive: true })
  const sourceNodeModules = await realpath(resolve(sourceRoot, 'node_modules'))
  const targetNodeModules = resolve(preflightRoot, 'node_modules')
  await Promise.all([
    copyFile(
      resolve(sourceRoot, 'package.json'),
      resolve(preflightRoot, 'package.json')
    ),
    cp(resolve(sourceRoot, 'agent'), resolve(preflightRoot, 'agent'), {
      recursive: true,
    }),
    symlink(
      sourceNodeModules,
      targetNodeModules,
      process.platform === 'win32' ? 'junction' : undefined
    ),
  ])
  if ((await realpath(targetNodeModules)) !== sourceNodeModules) {
    throw new Error(
      `${appDirectoryName} preflight root has invalid node_modules`
    )
  }
  const [sourcePackage, targetPackage, packageMetadata] = await Promise.all([
    readFile(resolve(sourceRoot, 'package.json'), 'utf8'),
    readFile(resolve(preflightRoot, 'package.json'), 'utf8'),
    lstat(resolve(preflightRoot, 'package.json')),
  ])
  await assertContainedSourceSnapshot(resolve(preflightRoot, 'agent'))
  if (!(packageMetadata.isFile() && targetPackage === sourcePackage)) {
    throw new Error(
      `${appDirectoryName} preflight root has an invalid package.json snapshot`
    )
  }
  return preflightRoot
}

const runHealthOnlyRootPreflight = async ({ root, stateDirectory, env }) => {
  const appDirectory = resolve(REPOSITORY_ROOT, 'apps', root.appDirectoryName)
  const materializeCode = await run({
    args: [
      resolve(REPOSITORY_ROOT, 'scripts/materialize-marketing-skills.mjs'),
    ],
    command: process.execPath,
    cwd: appDirectory,
    env,
  })
  if (materializeCode !== 0) {
    throw new Error(
      `${root.appDirectoryName} preflight materialization exited with code ${materializeCode}`
    )
  }
  const preflightRoot = await preparePreflightRoot({
    appDirectoryName: root.appDirectoryName,
    stateDirectory,
  })
  const port = await reserveLoopbackPort()
  const origin = `http://127.0.0.1:${String(port)}`
  const managedProcess = await startManagedProcess({
    args: [
      `--import=${SCRIPTED_PROVIDER_PRELOAD}`,
      resolve(preflightRoot, 'node_modules/eve/bin/eve.js'),
      'dev',
      '--no-ui',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    command: process.execPath,
    cwd: preflightRoot,
    env,
  })
  try {
    const health = await waitForEveHealth({ managedProcess, origin })
    const client = new EveClient({ host: origin, redirect: 'error' })
    const info = await client.info()
    const { response } = await client.sessions.create({
      message: ROOT_SMOKE_PROMPT,
    })
    const result = await response.result()
    const eventTypes = assertCompletePreflightResult({
      agent: root.agent,
      health,
      info,
      result,
    })
    await writeFile(
      resolve(stateDirectory, `root-preflight-${root.agent}.json`),
      `${JSON.stringify({
        agent: root.agent,
        eventTypes,
        infoName: info.agent.name,
        modelId: info.agent.model.id,
        reasoning: info.agent.model.reasoning,
        resultStatus: result.status,
        sessionId: result.sessionId,
        workflowId: health.workflowId,
      })}\n`
    )
    console.info(
      `[e2e] ${root.appDirectoryName} eve dev preflight completed session ${result.sessionId}`
    )
  } finally {
    await stopManagedProcess(managedProcess)
  }
}

const forwardSignal = (signal) => {
  receivedSignal = signal
  activeChild?.kill(signal)
}

process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))

const assertSafeDatabaseUrl = (value) => {
  const url = new URL(value)
  const isPostgres =
    url.protocol === 'postgres:' || url.protocol === 'postgresql:'
  const isLoopback =
    url.hostname === '127.0.0.1' ||
    url.hostname === 'localhost' ||
    url.hostname === '[::1]'
  const databaseName = decodeURIComponent(url.pathname.slice(1))

  if (!(isPostgres && isLoopback && databaseName === EXPECTED_DATABASE_NAME)) {
    throw new Error(
      `E2E requires a loopback PostgreSQL database named ${EXPECTED_DATABASE_NAME}`
    )
  }
}

const assertPostgres17 = async (connectionString) => {
  const client = new Client({ connectionString })
  try {
    await client.connect()
    const result = await client.query(
      "SELECT current_database() AS database_name, current_setting('server_version_num') AS version_number"
    )
    const [row] = result.rows
    const versionNumber = Number(row?.version_number)
    if (
      row?.database_name !== EXPECTED_DATABASE_NAME ||
      !(versionNumber >= 170_000 && versionNumber < 180_000)
    ) {
      throw new Error(
        'E2E requires PostgreSQL 17 and the dedicated test database'
      )
    }
  } finally {
    await client.end()
  }
}

const composeArgs = [
  'compose',
  '--project-name',
  COMPOSE_PROJECT,
  '--file',
  COMPOSE_FILE,
]
const useExistingDatabase = process.env.E2E_USE_EXISTING_DATABASE === '1'
const postgresPort = process.env.POSTGRES_TEST_PORT ?? DEFAULT_POSTGRES_PORT

if (!(PORT_PATTERN.test(postgresPort) && Number(postgresPort) <= 65_535)) {
  throw new Error('POSTGRES_TEST_PORT must be an integer between 1 and 65535')
}

if (useExistingDatabase && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required when E2E_USE_EXISTING_DATABASE=1')
}

const localDatabaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/${EXPECTED_DATABASE_NAME}`
const databaseUrl = useExistingDatabase
  ? process.env.DATABASE_URL
  : localDatabaseUrl
const directDatabaseUrl = useExistingDatabase
  ? (process.env.DIRECT_DATABASE_URL ?? databaseUrl)
  : localDatabaseUrl

assertSafeDatabaseUrl(databaseUrl)
assertSafeDatabaseUrl(directDatabaseUrl)

let composeStarted = false
let providerStateDirectory

try {
  if (!useExistingDatabase) {
    await run({
      args: [...composeArgs, 'down', '--remove-orphans'],
      command: 'docker',
    })
    composeStarted = true
    const upCode = await run({
      args: [...composeArgs, 'up', '--detach', '--wait', 'postgres'],
      command: 'docker',
      env: { ...process.env, POSTGRES_TEST_PORT: postgresPort },
    })
    if (upCode !== 0) {
      throw new Error(`docker compose up exited with code ${upCode}`)
    }
  }

  await assertPostgres17(databaseUrl)

  const migrationCode = await runMigration({
    args: ['migrate', '--config', 'drizzle.config.ts'],
    command: resolve(
      REPOSITORY_ROOT,
      'packages/db/node_modules/.bin/drizzle-kit'
    ),
    cwd: resolve(REPOSITORY_ROOT, 'packages/db'),
    env: {
      ...process.env,
      DIRECT_DATABASE_URL: directDatabaseUrl,
      NODE_ENV: 'test',
    },
    sensitiveValues: [databaseUrl, directDatabaseUrl],
  })
  await persistMigrationEvidence({
    sensitiveValues: [databaseUrl, directDatabaseUrl],
  })
  if (migrationCode !== 0) {
    throw new Error(`database migration exited with code ${migrationCode}`)
  }

  providerStateDirectory = await realpath(
    await mkdtemp(join(tmpdir(), 'branderize-e2e-providers-'))
  )

  const runtimeProcessEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) =>
        name !== 'DIRECT_DATABASE_URL' &&
        name !== 'EVE_DEV' &&
        name !== 'VERCEL' &&
        name !== 'VERCEL_ENV' &&
        name !== 'WORKFLOW_LOCAL_DATA_DIR' &&
        value !== undefined
    )
  )
  const e2eEnvironment = {
    ...runtimeProcessEnvironment,
    AGENT_CMO_URL: CMO_ORIGIN,
    AGENT_CONTENT_URL: CONTENT_ORIGIN,
    AGENT_DISTRIBUTION_URL: DISTRIBUTION_ORIGIN,
    AGENT_GROWTH_URL: GROWTH_ORIGIN,
    AGENT_LIFECYCLE_URL: LIFECYCLE_ORIGIN,
    AGENT_PRODUCT_MARKETER_URL: PRODUCT_MARKETER_ORIGIN,
    AGENT_SEO_DISCOVERY_URL: SEO_DISCOVERY_ORIGIN,
    AI_GATEWAY_API_KEY: 'branderize-e2e-scripted-gateway-key',
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    BETTER_AUTH_TRUSTED_ORIGINS: `${APP_ORIGIN},${WEB_ORIGIN}`,
    BETTER_AUTH_URL: APP_ORIGIN,
    BLOB_READ_WRITE_TOKEN: E2E_BLOB_TOKEN,
    BLOB_STORE_ID: E2E_BLOB_STORE_ID,
    CMO_BRIDGE_SECRET: TEST_CMO_SECRET,
    CONTEXT_DEV_API_KEY: E2E_CONTEXT_DEV_API_KEY,
    CRON_SECRET: TEST_CRON_SECRET,
    DATABASE_URL: databaseUrl,
    DISPATCH_SECRET: TEST_DISPATCH_SECRET,
    E2E_APP_ORIGIN: APP_ORIGIN,
    E2E_CMO_ORIGIN: CMO_ORIGIN,
    E2E_CONTENT_ORIGIN: CONTENT_ORIGIN,
    E2E_CRON_SECRET: TEST_CRON_SECRET,
    E2E_DISTRIBUTION_ORIGIN: DISTRIBUTION_ORIGIN,
    E2E_GROWTH_ORIGIN: GROWTH_ORIGIN,
    E2E_LIFECYCLE_ORIGIN: LIFECYCLE_ORIGIN,
    E2E_PRODUCT_MARKETER_ORIGIN: PRODUCT_MARKETER_ORIGIN,
    E2E_PROVIDER_MODE: 'scripted',
    E2E_PROVIDER_STATE_DIRECTORY: providerStateDirectory,
    E2E_SEO_DISCOVERY_ORIGIN: SEO_DISCOVERY_ORIGIN,
    E2E_WEB_ORIGIN: WEB_ORIGIN,
    GOOGLE_CLIENT_ID: GOOGLE_TEST_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: GOOGLE_TEST_CLIENT_SECRET,
    NEXT_PUBLIC_APP_URL: APP_ORIGIN,
    NODE_ENV: 'development',
  }
  const playwrightEnvironment = Object.fromEntries(
    Object.entries(e2eEnvironment).filter(([name]) => name !== 'NODE_OPTIONS')
  )
  const nextBuildEnvironment = {
    ...playwrightEnvironment,
    BETTER_AUTH_TRUSTED_ORIGINS: `${NEXT_BUILD_APP_ORIGIN},${NEXT_BUILD_WEB_ORIGIN}`,
    BETTER_AUTH_URL: NEXT_BUILD_APP_ORIGIN,
    E2E_EXPOSE_NEXT_TESTING_API: '1',
    NEXT_PUBLIC_APP_URL: APP_ORIGIN,
    NODE_ENV: 'production',
  }

  await runSequentially({
    items: HEALTH_ONLY_AGENT_ROOTS,
    operation: async (root) => {
      await runHealthOnlyRootPreflight({
        env: e2eEnvironment,
        root,
        stateDirectory: providerStateDirectory,
      })
    },
  })

  await runTurboBuild({
    env: e2eEnvironment,
    filters: AGENT_APP_DIRECTORIES,
    label: 'Eve agent',
  })
  await runTurboBuild({
    env: nextBuildEnvironment,
    filters: NEXT_APPLICATIONS.map(({ packageName }) => packageName),
    label: 'Next.js',
  })

  await Promise.all(
    AGENT_APP_DIRECTORIES.map(async (appDirectoryName) => {
      const sourceOutputDirectory = await realpath(
        resolve(REPOSITORY_ROOT, 'apps', appDirectoryName, '.output')
      )
      const runtimeRoot = resolve(
        providerStateDirectory,
        'runtime-roots',
        appDirectoryName
      )
      await mkdir(runtimeRoot, { recursive: true })
      const runtimeOutputDirectory = resolve(runtimeRoot, '.output')
      await symlink(
        sourceOutputDirectory,
        runtimeOutputDirectory,
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      const linkedOutputDirectory = await realpath(runtimeOutputDirectory)
      if (linkedOutputDirectory !== sourceOutputDirectory) {
        throw new Error(
          `${appDirectoryName} temporary runtime root does not point at its Eve build`
        )
      }
    })
  )

  const playwrightCode = await run({
    args: playwrightArguments,
    command: resolve(REPOSITORY_ROOT, 'node_modules/.bin/playwright'),
    env: playwrightEnvironment,
  })
  process.exitCode = playwrightCode
} finally {
  try {
    if (providerStateDirectory !== undefined) {
      await rm(providerStateDirectory, { force: true, recursive: true })
    }
    if (composeStarted) {
      const downCode = await run({
        args: [...composeArgs, 'down', '--remove-orphans'],
        command: 'docker',
        env: { ...process.env, POSTGRES_TEST_PORT: postgresPort },
      })
      if (downCode !== 0 && process.exitCode === undefined) {
        process.exitCode = downCode
      }
    }
  } finally {
    await persistMigrationEvidence({
      sensitiveValues: [databaseUrl, directDatabaseUrl],
    })
  }
}

if (receivedSignal) {
  process.kill(process.pid, receivedSignal)
}
