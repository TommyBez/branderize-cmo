#!/usr/bin/env node

import { fetchText, portIsListening } from '../lib/http.mjs'
import {
  AGENT_ORIGINS,
  APP_ORIGIN,
  APP_PORT,
  LANDING_HEADING,
  SIGN_IN_HEADING,
  WEB_ORIGIN,
  WEB_PORT,
} from '../lib/paths.mjs'
import { processIsAlive, readRunState } from '../lib/run-state.mjs'

const inspectSurface = async ({ heading, name, origin, path, port }) => {
  const listening = await portIsListening(port)
  const page = await fetchText(`${origin}${path}`)

  return {
    headingFound: page.body.includes(heading),
    listening,
    name,
    origin,
    status: page.status,
    worthDriving: page.ok && page.body.includes(heading),
  }
}

const driveStatus = ({ foreign, worthDriving }) => {
  if (foreign) {
    return 'refuse'
  }
  if (worthDriving) {
    return 'ok'
  }
  return 'down'
}

const inspectAgents = async () =>
  Promise.all(
    Object.entries(AGENT_ORIGINS).map(async ([name, origin]) => {
      const page = await fetchText(`${origin}/eve/v1/health`)
      return {
        name,
        origin,
        status: page.status,
        worthDriving: page.ok,
      }
    })
  )

const runState = readRunState()
const ourPidAlive = runState === null ? false : processIsAlive(runState.pid)
const web = await inspectSurface({
  heading: LANDING_HEADING,
  name: 'web',
  origin: WEB_ORIGIN,
  path: '/',
  port: WEB_PORT,
})
const app = await inspectSurface({
  heading: SIGN_IN_HEADING,
  name: 'app',
  origin: APP_ORIGIN,
  path: '/sign-in',
  port: APP_PORT,
})
const agents = await inspectAgents()

const webIsOurs =
  ourPidAlive && (runState.mode === 'web' || runState.mode === 'fleet')
const appIsOurs = ourPidAlive && runState.mode === 'fleet'
const webForeign = web.listening && !webIsOurs
const appForeign = app.listening && !appIsOurs

const isolation = []
if (webForeign) {
  isolation.push(
    'refuse web: port 3000 is occupied by a process this skill did not start'
  )
}
if (appForeign) {
  isolation.push(
    'refuse console: port 3001 is occupied by a process this skill did not start'
  )
}
if (isolation.length === 0 && runState === null) {
  isolation.push('idle: no verify run is recorded. Launch before driving.')
} else if (isolation.length === 0 && !ourPidAlive) {
  isolation.push('stale: run.json exists but the recorded pid is gone')
} else if (isolation.length === 0) {
  isolation.push(`ours: run ${runState.runId} (${runState.mode}) is alive`)
}

const report = {
  agents,
  app: {
    ...app,
    drive: driveStatus({ foreign: appForeign, worthDriving: app.worthDriving }),
  },
  isolation,
  ok: webIsOurs && web.worthDriving && !webForeign,
  runState:
    runState === null
      ? null
      : {
          alive: ourPidAlive,
          artifactDir: runState.artifactDir,
          mode: runState.mode,
          pid: runState.pid,
          runId: runState.runId,
        },
  web: {
    ...web,
    drive: driveStatus({ foreign: webForeign, worthDriving: web.worthDriving }),
  },
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exitCode = report.ok ? 0 : 1
