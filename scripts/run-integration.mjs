import { spawn } from 'node:child_process'

const COMPOSE_FILE = 'compose.yaml'
const COMPOSE_PROJECT = 'branderize-cmo-integration'
const DEFAULT_POSTGRES_PORT = '54329'
const PORT_PATTERN = /^\d{1,5}$/

let activeChild
let receivedSignal

const run = ({ command, args, env = process.env }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: 'inherit',
    })
    activeChild = child

    child.once('error', reject)
    child.once('close', (code, signal) => {
      activeChild = undefined
      if (signal) {
        reject(new Error(`${command} stopped after receiving ${signal}`))
        return
      }
      resolve(code ?? 1)
    })
  })

const stopActiveChild = (signal) => {
  receivedSignal = signal
  activeChild?.kill(signal)
}

process.once('SIGINT', () => stopActiveChild('SIGINT'))
process.once('SIGTERM', () => stopActiveChild('SIGTERM'))

const composeArgs = [
  'compose',
  '--project-name',
  COMPOSE_PROJECT,
  '--file',
  COMPOSE_FILE,
]
const useExistingDatabase =
  process.env.INTEGRATION_USE_EXISTING_DATABASE === '1'
const postgresPort = process.env.POSTGRES_TEST_PORT ?? DEFAULT_POSTGRES_PORT

if (!(PORT_PATTERN.test(postgresPort) && Number(postgresPort) <= 65_535)) {
  throw new Error('POSTGRES_TEST_PORT must be an integer between 1 and 65535')
}

if (useExistingDatabase && !process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required when INTEGRATION_USE_EXISTING_DATABASE=1'
  )
}

let composeStarted = false

try {
  if (!useExistingDatabase) {
    composeStarted = true
    const upCode = await run({
      args: [...composeArgs, 'up', '--detach', '--wait', 'postgres'],
      command: 'docker',
    })
    if (upCode !== 0) {
      throw new Error(`docker compose up exited with code ${upCode}`)
    }
  }

  const localDatabaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/branderize_test`
  const databaseUrl = useExistingDatabase
    ? process.env.DATABASE_URL
    : localDatabaseUrl
  const directDatabaseUrl = useExistingDatabase
    ? (process.env.DIRECT_DATABASE_URL ?? databaseUrl)
    : localDatabaseUrl

  const testCode = await run({
    args: ['exec', 'turbo', 'run', 'test:integration'],
    command: 'pnpm',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_DATABASE_URL: directDatabaseUrl,
      NODE_ENV: 'test',
      VITEST_SUITE: 'integration',
    },
  })
  process.exitCode = testCode
} finally {
  if (composeStarted) {
    const downCode = await run({
      args: [...composeArgs, 'down', '--remove-orphans'],
      command: 'docker',
    })
    if (downCode !== 0 && process.exitCode === undefined) {
      process.exitCode = downCode
    }
  }
}

if (receivedSignal) {
  process.kill(process.pid, receivedSignal)
}
