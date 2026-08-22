#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ensurePortlessProxy,
  originIsOccupied,
} from '../../../../scripts/dev-local.mjs'
import { fetchText, portIsListening } from '../lib/http.mjs'
import {
  APP_ORIGIN,
  EVIDENCE_ROOT,
  fleetAppOrigin,
  fleetWebOrigin,
  LANDING_HEADING,
  REPOSITORY_ROOT,
  SIGN_IN_HEADING,
  WEB_ORIGIN,
  WEB_PORT,
} from '../lib/paths.mjs'
import {
  processIsAlive,
  readRunState,
  writeRunState,
} from '../lib/run-state.mjs'

const READY_TIMEOUT_MS = 180_000
const POLL_MS = 1000

const usage = () => {
  process.stderr.write('Usage: node bin/launch.mjs web|fleet\n')
  process.exitCode = 1
}

const [, , mode] = process.argv
if (mode !== 'web' && mode !== 'fleet') {
  usage()
  process.exit(1)
}

const existing = readRunState()
if (existing !== null && processIsAlive(existing.pid)) {
  process.stderr.write(
    `A verify run is already active: ${existing.runId} (pid ${String(existing.pid)}). Clean it up first.\n`
  )
  process.exit(1)
}

const fleetSource =
  mode === 'fleet' ? { PORTLESS_PROXY_PORT: ensurePortlessProxy() } : undefined
const webOrigin =
  fleetSource === undefined ? WEB_ORIGIN : fleetWebOrigin(fleetSource)
const appOrigin =
  fleetSource === undefined ? APP_ORIGIN : fleetAppOrigin(fleetSource)
const useInsecureTls = false

if (mode === 'web' && (await portIsListening(WEB_PORT))) {
  process.stderr.write(
    'Refuse to launch: port 3000 already listening. Stop that instance or skip driving.\n'
  )
  process.exit(1)
}

if (mode === 'fleet') {
  const occupiedFleet = (
    await Promise.all(
      [webOrigin, appOrigin].map(async (origin) =>
        (await originIsOccupied(origin)) ? origin : undefined
      )
    )
  ).filter((origin) => origin !== undefined)
  if (occupiedFleet.length > 0) {
    process.stderr.write(
      `Refuse to launch: already responding: ${occupiedFleet.join(', ')}. Stop that instance or skip driving.\n`
    )
    process.exit(1)
  }
}

const runId = `verify-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`
const artifactDir = resolve(EVIDENCE_ROOT, runId)
mkdirSync(artifactDir, { recursive: true })
const logFd = openSync(resolve(artifactDir, 'launch.log'), 'a')

const child =
  mode === 'web'
    ? spawn(
        'pnpm',
        ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3000'],
        {
          cwd: resolve(REPOSITORY_ROOT, 'apps/web'),
          detached: true,
          env: {
            ...process.env,
            NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
          },
          stdio: ['ignore', logFd, logFd],
        }
      )
    : spawn('pnpm', ['dev:local'], {
        cwd: REPOSITORY_ROOT,
        detached: true,
        env: {
          ...process.env,
          PORTLESS_HTTPS: '0',
          PORTLESS_PROXY_PORT: fleetSource.PORTLESS_PROXY_PORT,
        },
        stdio: ['ignore', logFd, logFd],
      })

if (child.pid === undefined) {
  process.stderr.write('Failed to spawn the verification process.\n')
  process.exit(1)
}

child.unref()

const state = {
  artifactDir,
  mode,
  pid: child.pid,
  runId,
  startedAt: new Date().toISOString(),
  webOrigin,
}
writeRunState(state)

const waitFor = async (
  url,
  needle,
  deadline = Date.now() + READY_TIMEOUT_MS
) => {
  const page = await fetchText(url, { insecureTls: useInsecureTls })
  if (page.ok && page.body.includes(needle)) {
    return
  }
  if (Date.now() >= deadline) {
    throw new Error(`Timed out waiting for ${url} to contain ${needle}`)
  }
  await new Promise((resolveReady) => setTimeout(resolveReady, POLL_MS))
  await waitFor(url, needle, deadline)
}

try {
  await waitFor(`${webOrigin}/`, LANDING_HEADING)
  if (mode === 'fleet') {
    await waitFor(`${appOrigin}/sign-in`, SIGN_IN_HEADING)
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  )
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      process.kill(child.pid, 'SIGTERM')
    } catch {
      // The process already exited.
    }
  }
  process.exit(1)
}

process.stdout.write(
  `${JSON.stringify({ artifactDir, mode, pid: child.pid, runId, webOrigin }, null, 2)}\n`
)
process.exit(0)
