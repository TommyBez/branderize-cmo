import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const LOOPBACK_HOST = '127.0.0.1'
const BROWSER_HOST = 'localhost'
const SHUTDOWN_GRACE_PERIOD_MS = 5000
const SECRET_MINIMUM_LENGTH = 32

const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
}

export const LOCAL_AGENT_ORIGINS = Object.freeze({
  AGENT_CMO_URL: `http://${LOOPBACK_HOST}:2000`,
  AGENT_CONTENT_URL: `http://${LOOPBACK_HOST}:2002`,
  AGENT_DISTRIBUTION_URL: `http://${LOOPBACK_HOST}:2003`,
  AGENT_GROWTH_URL: `http://${LOOPBACK_HOST}:2004`,
  AGENT_LIFECYCLE_URL: `http://${LOOPBACK_HOST}:2005`,
  AGENT_PRODUCT_MARKETER_URL: `http://${LOOPBACK_HOST}:2001`,
  AGENT_SEO_DISCOVERY_URL: `http://${LOOPBACK_HOST}:2006`,
})

const APP_ORIGIN = `http://${BROWSER_HOST}:3001`
const WEB_ORIGIN = `http://${BROWSER_HOST}:3000`

export const REQUIRED_LOCAL_ENVIRONMENT_KEYS = Object.freeze([
  'BETTER_AUTH_SECRET',
  'BLOB_STORE_ID',
  'CMO_BRIDGE_SECRET',
  'CONTEXT_DEV_API_KEY',
  'CRON_SECRET',
  'DATABASE_URL',
  'DISPATCH_SECRET',
  'VERCEL_OIDC_TOKEN',
])

const SECRET_ENVIRONMENT_KEYS = Object.freeze([
  'BETTER_AUTH_SECRET',
  'CMO_BRIDGE_SECRET',
  'CRON_SECRET',
  'DISPATCH_SECRET',
])

const APP_ONLY_ENVIRONMENT_KEYS = Object.freeze([
  ...Object.keys(LOCAL_AGENT_ORIGINS),
  'AUTH_LOCAL_OTP_BYPASS',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'BETTER_AUTH_URL',
  'BLOB_STORE_ID',
  'CMO_BRIDGE_SECRET',
  'CONTEXT_DEV_API_KEY',
  'CRON_SECRET',
  'DIRECT_DATABASE_URL',
  'NEXT_PUBLIC_APP_URL',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
])

const LOCAL_EMAIL_DELIVERY_KEYS = Object.freeze([
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
])

const WEB_PRIVATE_ENVIRONMENT_KEYS = Object.freeze([
  ...APP_ONLY_ENVIRONMENT_KEYS,
  'DATABASE_URL',
  'DISPATCH_SECRET',
  'VERCEL_OIDC_TOKEN',
])

const defineNextService = ({ name, path, port }) =>
  Object.freeze({
    args: [
      'exec',
      'next',
      'dev',
      '--hostname',
      LOOPBACK_HOST,
      '--port',
      String(port),
    ],
    command: 'pnpm',
    kind: name,
    name,
    path,
    port,
  })

const defineAgentService = ({ agentKey, path, port }) =>
  Object.freeze({
    agentKey,
    args: [
      'exec',
      'eve',
      'dev',
      '--host',
      LOOPBACK_HOST,
      '--port',
      String(port),
      '--no-ui',
      '--name',
      agentKey,
    ],
    command: 'pnpm',
    kind: 'agent',
    name: agentKey,
    path,
    port,
  })

export const LOCAL_DEV_SERVICES = Object.freeze([
  defineAgentService({
    agentKey: 'cmo',
    path: 'apps/agent-cmo',
    port: 2000,
  }),
  defineAgentService({
    agentKey: 'product-marketer',
    path: 'apps/agent-product-marketer',
    port: 2001,
  }),
  defineAgentService({
    agentKey: 'content',
    path: 'apps/agent-content',
    port: 2002,
  }),
  defineAgentService({
    agentKey: 'distribution',
    path: 'apps/agent-distribution',
    port: 2003,
  }),
  defineAgentService({
    agentKey: 'growth',
    path: 'apps/agent-growth',
    port: 2004,
  }),
  defineAgentService({
    agentKey: 'lifecycle',
    path: 'apps/agent-lifecycle',
    port: 2005,
  }),
  defineAgentService({
    agentKey: 'seo-discovery',
    path: 'apps/agent-seo-discovery',
    port: 2006,
  }),
  defineNextService({ name: 'web', path: 'apps/web', port: 3000 }),
  defineNextService({ name: 'app', path: 'apps/app', port: 3001 }),
])

const hasEnvironmentValue = (source, key) => {
  const value = source[key]
  return typeof value === 'string' && value.trim().length > 0
}

const hasPostgresProtocol = (value) => {
  try {
    const { protocol } = new URL(value)
    return protocol === 'postgres:' || protocol === 'postgresql:'
  } catch {
    return false
  }
}

export const localEnvironmentProblems = (source) => {
  const problems = []
  const missingKeys = REQUIRED_LOCAL_ENVIRONMENT_KEYS.filter(
    (key) => !hasEnvironmentValue(source, key)
  )

  if (missingKeys.length > 0) {
    problems.push(`missing ${missingKeys.join(', ')}`)
  }

  const shortSecretKeys = SECRET_ENVIRONMENT_KEYS.filter(
    (key) =>
      hasEnvironmentValue(source, key) &&
      source[key].trim().length < SECRET_MINIMUM_LENGTH
  )
  if (shortSecretKeys.length > 0) {
    problems.push(
      `must contain at least ${String(SECRET_MINIMUM_LENGTH)} characters: ${shortSecretKeys.join(', ')}`
    )
  }

  if (
    hasEnvironmentValue(source, 'DATABASE_URL') &&
    !hasPostgresProtocol(source.DATABASE_URL)
  ) {
    problems.push('DATABASE_URL must be a PostgreSQL URL')
  }

  return problems
}

export const assertLocalEnvironment = (source) => {
  const problems = localEnvironmentProblems(source)
  if (problems.length > 0) {
    throw new Error(
      `Local development environment is invalid: ${problems.join('; ')}. Configure apps/app/.env.local or export the missing values.`
    )
  }
}

const omitEnvironmentKeys = (source, keys) => {
  const environment = { ...source }
  for (const key of keys) {
    delete environment[key]
  }
  return environment
}

export const createLocalServiceEnvironment = (service, source) => {
  const localBaseEnvironment = {
    ...source,
    NODE_ENV: 'development',
    VERCEL_ENV: 'development',
  }

  if (service.kind === 'app') {
    return {
      ...omitEnvironmentKeys(localBaseEnvironment, LOCAL_EMAIL_DELIVERY_KEYS),
      ...LOCAL_AGENT_ORIGINS,
      AUTH_LOCAL_OTP_BYPASS: '1',
      BETTER_AUTH_TRUSTED_ORIGINS: `${WEB_ORIGIN},${APP_ORIGIN}`,
      BETTER_AUTH_URL: APP_ORIGIN,
      NEXT_PUBLIC_APP_URL: APP_ORIGIN,
    }
  }

  if (service.kind === 'web') {
    return {
      ...omitEnvironmentKeys(
        localBaseEnvironment,
        WEB_PRIVATE_ENVIRONMENT_KEYS
      ),
      NEXT_PUBLIC_APP_URL: APP_ORIGIN,
    }
  }

  const agentEnvironment = {
    ...omitEnvironmentKeys(localBaseEnvironment, APP_ONLY_ENVIRONMENT_KEYS),
    DATABASE_URL: source.DATABASE_URL,
    DISPATCH_SECRET: source.DISPATCH_SECRET,
  }

  if (service.agentKey !== 'cmo') {
    return agentEnvironment
  }

  return {
    ...agentEnvironment,
    AGENT_PRODUCT_MARKETER_URL: LOCAL_AGENT_ORIGINS.AGENT_PRODUCT_MARKETER_URL,
    CMO_BRIDGE_SECRET: source.CMO_BRIDGE_SECRET,
  }
}

const probePort = (service) =>
  new Promise((resolveProbe, rejectProbe) => {
    const server = createServer()

    server.once('error', (error) => {
      rejectProbe(
        new Error(
          `Cannot start ${service.name} on ${LOOPBACK_HOST}:${String(service.port)}: ${error.message}`
        )
      )
    })
    server.listen(service.port, LOOPBACK_HOST, () => {
      server.close((error) => {
        if (error) {
          rejectProbe(error)
          return
        }
        resolveProbe()
      })
    })
  })

export const assertLocalPortsAvailable = async () => {
  await Promise.all(LOCAL_DEV_SERVICES.map((service) => probePort(service)))
}

const signalProcessTree = (child, signal) => {
  if (child.pid === undefined) {
    return
  }

  try {
    if (process.platform === 'win32') {
      child.kill(signal)
      return
    }
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      process.stderr.write(
        `[dev:local] could not send ${signal} to process ${String(child.pid)}: ${error.message}\n`
      )
    }
  }
}

export const runLocalDevelopment = async (source = process.env) => {
  assertLocalEnvironment(source)
  await assertLocalPortsAvailable()

  const children = new Map()
  let exitCode = 0
  let shuttingDown = false
  let shutdownTimer
  let resolveFinished
  const finished = new Promise((resolveRun) => {
    resolveFinished = resolveRun
  })

  const finishWhenStopped = () => {
    if (shuttingDown && children.size === 0) {
      if (shutdownTimer !== undefined) {
        clearTimeout(shutdownTimer)
      }
      resolveFinished()
    }
  }

  const stopAll = (signal) => {
    for (const child of children.values()) {
      signalProcessTree(child, signal)
    }
  }

  const beginShutdown = (requestedExitCode) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    exitCode = requestedExitCode
    stopAll('SIGTERM')
    shutdownTimer = setTimeout(() => {
      stopAll('SIGKILL')
    }, SHUTDOWN_GRACE_PERIOD_MS)
    finishWhenStopped()
  }

  const handleSignal = (signal) => {
    process.stdout.write(
      `\n[dev:local] received ${signal}; stopping services\n`
    )
    beginShutdown(SIGNAL_EXIT_CODES[signal])
  }

  const handleSigint = () => handleSignal('SIGINT')
  const handleSigterm = () => handleSignal('SIGTERM')
  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)

  for (const service of LOCAL_DEV_SERVICES) {
    process.stdout.write(
      `[dev:local] starting ${service.name} on ${LOOPBACK_HOST}:${String(service.port)}\n`
    )
    const child = spawn(service.command, service.args, {
      cwd: resolve(REPOSITORY_ROOT, service.path),
      detached: process.platform !== 'win32',
      env: createLocalServiceEnvironment(service, source),
      stdio: 'inherit',
    })
    children.set(service.name, child)

    child.once('error', (error) => {
      process.stderr.write(
        `[dev:local] ${service.name} failed to start: ${error.message}\n`
      )
      beginShutdown(1)
    })
    child.once('close', (code, signal) => {
      children.delete(service.name)
      if (!shuttingDown) {
        const outcome = signal ?? `exit code ${String(code)}`
        process.stderr.write(
          `[dev:local] ${service.name} stopped unexpectedly with ${outcome}\n`
        )
        beginShutdown(code === null || code === 0 ? 1 : code)
      }
      finishWhenStopped()
    })
  }

  process.stdout.write(
    `[dev:local] web ${WEB_ORIGIN} | app ${APP_ORIGIN} | agents ${LOOPBACK_HOST}:2000-2006\n`
  )

  await finished
  process.removeListener('SIGINT', handleSigint)
  process.removeListener('SIGTERM', handleSigterm)
  process.exitCode = exitCode
}

const [, entryPath] = process.argv
const isMainModule =
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPath)).href

if (isMainModule) {
  try {
    await runLocalDevelopment()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[dev:local] ${message}\n`)
    process.exitCode = 1
  }
}
