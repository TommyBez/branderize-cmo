#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { resolve } from 'node:path'

import { fetchText, portIsListening } from '../lib/http.mjs'
import {
  AGENT_PORTS,
  APP_ORIGIN,
  APP_PORT,
  EVIDENCE_ROOT,
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

const READY_TIMEOUT_MS = 90_000
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

const requiredPorts =
  mode === 'web' ? [WEB_PORT] : [WEB_PORT, APP_PORT, ...AGENT_PORTS]
const portStates = await Promise.all(
  requiredPorts.map(async (port) => ({
    busy: await portIsListening(port),
    port,
  }))
)
const busyPorts = portStates
  .filter((entry) => entry.busy)
  .map((entry) => entry.port)
if (busyPorts.length > 0) {
  process.stderr.write(
    `Refuse to launch: port(s) ${busyPorts.join(', ')} already listening. The local fleet cannot share 3000/3001/2000-2006. Stop that instance or skip driving.\n`
  )
  process.exit(1)
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
  webOrigin: WEB_ORIGIN,
}
writeRunState(state)

const waitFor = async (
  url,
  needle,
  deadline = Date.now() + READY_TIMEOUT_MS
) => {
  const page = await fetchText(url)
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
  await waitFor(`${WEB_ORIGIN}/`, LANDING_HEADING)
  if (mode === 'fleet') {
    await waitFor(`${APP_ORIGIN}/sign-in`, SIGN_IN_HEADING)
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  )
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    process.kill(child.pid, 'SIGTERM')
  }
  process.exit(1)
}

process.stdout.write(
  `${JSON.stringify({ artifactDir, mode, pid: child.pid, runId, webOrigin: WEB_ORIGIN }, null, 2)}\n`
)
process.exit(0)
