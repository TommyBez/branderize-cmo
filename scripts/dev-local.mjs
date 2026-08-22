import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const LOOPBACK_HOST = '127.0.0.1'
const SHUTDOWN_GRACE_PERIOD_MS = 5000
const SECRET_MINIMUM_LENGTH = 32
const ORIGIN_PROBE_TIMEOUT_MS = 800
const PORTLESS_BIN = resolve(REPOSITORY_ROOT, 'node_modules/.bin/portless')
const MARKETING_SKILLS_PACKAGE = resolve(
  REPOSITORY_ROOT,
  'packages/marketing-skills'
)
const MATERIALIZE_MARKETING_SKILLS = resolve(
  REPOSITORY_ROOT,
  'scripts/materialize-marketing-skills.mjs'
)

export const MARKETING_SKILLS_BUILD_ARGS = Object.freeze([
  'exec',
  'turbo',
  'run',
  'build',
  '--filter=@repo/marketing-skills',
])

export const REQUIRED_MARKETING_SKILLS_DIST_PATHS = Object.freeze([
  'dist/index.mjs',
  'dist/extension/skills/copywriting/SKILL.md',
  'dist/extension/skills/copywriting/references/natural-transitions.md',
])

const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
}

const DEFAULT_PORTLESS_PROXY_PORT = '1355'
const DEFAULT_HTTP_PORT = '80'

export const resolvePortlessProxyPort = (source = process.env) => {
  const configured = source.PORTLESS_PROXY_PORT ?? source.PORTLESS_HTTPS_PORT
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim()
  }
  return DEFAULT_PORTLESS_PROXY_PORT
}

export const resolveLocalOrigin = (name, source = process.env) => {
  const port = resolvePortlessProxyPort(source)
  return port === DEFAULT_HTTP_PORT
    ? `http://${name}.localhost`
    : `http://${name}.localhost:${port}`
}

const localOrigin = (name) => resolveLocalOrigin(name)

export const LOCAL_WEB_ORIGIN = localOrigin('web')
export const LOCAL_APP_ORIGIN = localOrigin('app')

export const LOCAL_AGENT_ORIGINS = Object.freeze({
  AGENT_CMO_URL: localOrigin('cmo'),
  AGENT_CONTENT_URL: localOrigin('content'),
  AGENT_DISTRIBUTION_URL: localOrigin('distribution'),
  AGENT_GROWTH_URL: localOrigin('growth'),
  AGENT_LIFECYCLE_URL: localOrigin('lifecycle'),
  AGENT_PRODUCT_MARKETER_URL: localOrigin('product-marketer'),
  AGENT_SEO_DISCOVERY_URL: localOrigin('seo-discovery'),
})

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

const defineNextService = ({ name, path }) =>
  Object.freeze({
    args: [
      name,
      '--',
      'pnpm',
      'exec',
      'next',
      'dev',
      '--hostname',
      LOOPBACK_HOST,
    ],
    command: PORTLESS_BIN,
    kind: name,
    name,
    origin: localOrigin(name),
    originName: name,
    path,
    portlessName: name,
  })

const defineAgentService = ({ agentKey, path }) =>
  Object.freeze({
    agentKey,
    args: [
      agentKey,
      '--',
      'sh',
      '-c',
      `pnpm exec eve dev --host ${LOOPBACK_HOST} --port "$PORT" --no-ui --name ${agentKey}`,
    ],
    command: PORTLESS_BIN,
    kind: 'agent',
    name: agentKey,
    origin: localOrigin(agentKey),
    originName: agentKey,
    path,
    portlessName: agentKey,
  })

export const LOCAL_DEV_SERVICES = Object.freeze([
  defineAgentService({
    agentKey: 'cmo',
    path: 'apps/agent-cmo',
  }),
  defineAgentService({
    agentKey: 'product-marketer',
    path: 'apps/agent-product-marketer',
  }),
  defineAgentService({
    agentKey: 'content',
    path: 'apps/agent-content',
  }),
  defineAgentService({
    agentKey: 'distribution',
    path: 'apps/agent-distribution',
  }),
  defineAgentService({
    agentKey: 'growth',
    path: 'apps/agent-growth',
  }),
  defineAgentService({
    agentKey: 'lifecycle',
    path: 'apps/agent-lifecycle',
  }),
  defineAgentService({
    agentKey: 'seo-discovery',
    path: 'apps/agent-seo-discovery',
  }),
  defineNextService({ name: 'web', path: 'apps/web' }),
  defineNextService({ name: 'app', path: 'apps/app' }),
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

export const assertMarketingSkillsDist = () => {
  const missing = REQUIRED_MARKETING_SKILLS_DIST_PATHS.filter(
    (relativePath) =>
      !existsSync(resolve(MARKETING_SKILLS_PACKAGE, relativePath))
  )
  if (missing.length > 0) {
    throw new Error(
      `@repo/marketing-skills dist is incomplete: ${missing.join(', ')}`
    )
  }
}

export const ensureMarketingSkillsBuild = () => {
  process.stdout.write('[dev:local] materializing marketing skills\n')
  const materialized = spawnSync(
    process.execPath,
    [MATERIALIZE_MARKETING_SKILLS],
    {
      cwd: MARKETING_SKILLS_PACKAGE,
      encoding: 'utf8',
      stdio: 'inherit',
    }
  )
  if (materialized.status !== 0) {
    throw new Error('Failed to materialize marketing skills for local agents')
  }

  process.stdout.write('[dev:local] building @repo/marketing-skills\n')
  const built = spawnSync('pnpm', MARKETING_SKILLS_BUILD_ARGS, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (built.status !== 0) {
    throw new Error('Failed to build @repo/marketing-skills for local agents')
  }

  assertMarketingSkillsDist()
}

const omitEnvironmentKeys = (source, keys) => {
  const environment = { ...source }
  for (const key of keys) {
    delete environment[key]
  }
  return environment
}

const agentOriginsFor = (source) =>
  Object.freeze({
    AGENT_CMO_URL: resolveLocalOrigin('cmo', source),
    AGENT_CONTENT_URL: resolveLocalOrigin('content', source),
    AGENT_DISTRIBUTION_URL: resolveLocalOrigin('distribution', source),
    AGENT_GROWTH_URL: resolveLocalOrigin('growth', source),
    AGENT_LIFECYCLE_URL: resolveLocalOrigin('lifecycle', source),
    AGENT_PRODUCT_MARKETER_URL: resolveLocalOrigin('product-marketer', source),
    AGENT_SEO_DISCOVERY_URL: resolveLocalOrigin('seo-discovery', source),
  })

const cmoSpecialistOriginsFor = (source) =>
  Object.freeze({
    AGENT_CONTENT_URL: resolveLocalOrigin('content', source),
    AGENT_DISTRIBUTION_URL: resolveLocalOrigin('distribution', source),
    AGENT_PRODUCT_MARKETER_URL: resolveLocalOrigin('product-marketer', source),
    AGENT_SEO_DISCOVERY_URL: resolveLocalOrigin('seo-discovery', source),
  })

export const createLocalServiceEnvironment = (service, source) => {
  const localBaseEnvironment = {
    ...source,
    NODE_ENV: 'development',
    PORTLESS_HTTPS: '0',
    VERCEL_ENV: 'development',
  }
  const webOrigin = resolveLocalOrigin('web', source)
  const appOrigin = resolveLocalOrigin('app', source)

  if (service.kind === 'app') {
    return {
      ...omitEnvironmentKeys(localBaseEnvironment, LOCAL_EMAIL_DELIVERY_KEYS),
      ...agentOriginsFor(source),
      AUTH_LOCAL_OTP_BYPASS: '1',
      BETTER_AUTH_TRUSTED_ORIGINS: `${webOrigin},${appOrigin}`,
      BETTER_AUTH_URL: appOrigin,
      NEXT_PUBLIC_APP_URL: appOrigin,
    }
  }

  if (service.kind === 'web') {
    return {
      ...omitEnvironmentKeys(
        localBaseEnvironment,
        WEB_PRIVATE_ENVIRONMENT_KEYS
      ),
      NEXT_PUBLIC_APP_URL: appOrigin,
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
    ...cmoSpecialistOriginsFor(source),
    CMO_BRIDGE_SECRET: source.CMO_BRIDGE_SECRET,
  }
}

export const originIsOccupied = (origin) =>
  new Promise((resolveOccupied) => {
    const url = new URL(origin)
    const { protocol } = url
    let { port } = url
    const transport = protocol === 'https:' ? httpsRequest : httpRequest
    if (port === '') {
      port = protocol === 'https:' ? 443 : 80
    }
    const request = transport(
      {
        hostname: url.hostname,
        method: 'GET',
        path: `${url.pathname}${url.search}` || '/',
        port,
        rejectUnauthorized: false,
        timeout: ORIGIN_PROBE_TIMEOUT_MS,
      },
      (response) => {
        response.resume()
        const status = response.statusCode ?? 0
        const portlessMiss =
          status === 404 && response.headers['x-portless'] === '1'
        resolveOccupied(status > 0 && !portlessMiss)
      }
    )
    request.once('error', () => {
      resolveOccupied(false)
    })
    request.once('timeout', () => {
      request.destroy()
      resolveOccupied(false)
    })
    request.end()
  })

const PORTLESS_PROXY_PORT_PATH = resolve(homedir(), '.portless/proxy.port')

export const readRunningProxyPort = () => {
  try {
    const port = readFileSync(PORTLESS_PROXY_PORT_PATH, 'utf8').trim()
    if (port.length > 0) {
      return port
    }
  } catch {
    // No proxy port file yet.
  }
}

export const ensurePortlessProxy = (source = process.env) => {
  const requestedPort = resolvePortlessProxyPort({
    ...source,
    PORTLESS_PROXY_PORT:
      source.PORTLESS_PROXY_PORT ??
      source.PORTLESS_HTTPS_PORT ??
      readRunningProxyPort() ??
      DEFAULT_PORTLESS_PROXY_PORT,
  })
  spawnSync(PORTLESS_BIN, ['proxy', 'stop', '-p', requestedPort], {
    encoding: 'utf8',
  })
  const started = spawnSync(
    PORTLESS_BIN,
    ['proxy', 'start', '--no-tls', '--port', requestedPort],
    { encoding: 'utf8' }
  )
  const runningPort = readRunningProxyPort() ?? requestedPort
  if (started.status !== 0 && readRunningProxyPort() === undefined) {
    throw new Error(
      `Portless proxy failed to start: ${(started.stderr || started.stdout).trim()}`
    )
  }
  return runningPort
}

export const assertLocalPortsAvailable = async (source = process.env) => {
  const occupiedServices = await Promise.all(
    LOCAL_DEV_SERVICES.map(async (service) => {
      const origin = resolveLocalOrigin(service.originName, source)
      return (await originIsOccupied(origin))
        ? `${service.name} (${origin})`
        : undefined
    })
  )
  const occupied = occupiedServices.filter((entry) => entry !== undefined)

  if (occupied.length > 0) {
    throw new Error(
      `Cannot start local development; already responding: ${occupied.join(', ')}`
    )
  }
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
  ensureMarketingSkillsBuild()
  const proxyPort = ensurePortlessProxy(source)
  const sourced = {
    ...source,
    PORTLESS_HTTPS: '0',
    PORTLESS_PROXY_PORT: proxyPort,
  }
  await assertLocalPortsAvailable(sourced)

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
    const origin = resolveLocalOrigin(service.originName, sourced)
    process.stdout.write(`[dev:local] starting ${service.name} at ${origin}\n`)
    const child = spawn(service.command, service.args, {
      cwd: resolve(REPOSITORY_ROOT, service.path),
      detached: process.platform !== 'win32',
      env: createLocalServiceEnvironment(service, sourced),
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
    `[dev:local] web ${resolveLocalOrigin('web', sourced)} | app ${resolveLocalOrigin('app', sourced)} | agents ${Object.values(agentOriginsFor(sourced)).join(', ')}\n`
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
