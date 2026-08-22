#!/usr/bin/env node

import { readRunningProxyPort } from '../../../../scripts/dev-local.mjs'
import { fetchText, portIsListening } from '../lib/http.mjs'
import {
  AGENT_ORIGINS,
  APP_ORIGIN,
  APP_PORT,
  fleetAppOrigin,
  fleetWebOrigin,
  LANDING_HEADING,
  SIGN_IN_HEADING,
  WEB_ORIGIN,
  WEB_PORT,
} from '../lib/paths.mjs'
import { processIsAlive, readRunState } from '../lib/run-state.mjs'

const driveStatus = ({ foreign, worthDriving }) => {
  if (foreign) {
    return 'refuse'
  }
  if (worthDriving) {
    return 'ok'
  }
  return 'down'
}

const occupiedMessage = ({ isFleetSurface, kind, origin, port }) => {
  if (isFleetSurface) {
    return `refuse ${kind}: ${origin} is occupied by a process this skill did not start`
  }
  return `refuse ${kind}: port ${String(port)} is occupied by a process this skill did not start`
}

const isolationMessages = (input) => {
  const messages = []
  if (input.webForeign) {
    messages.push(
      occupiedMessage({
        isFleetSurface: input.isFleet,
        kind: 'web',
        origin: input.webOrigin,
        port: WEB_PORT,
      })
    )
  }
  if (input.appForeign) {
    messages.push(
      occupiedMessage({
        isFleetSurface: input.isFleet,
        kind: 'console',
        origin: input.appOrigin,
        port: APP_PORT,
      })
    )
  }
  if (messages.length > 0) {
    return messages
  }
  if (input.runState === null) {
    return ['idle: no verify run is recorded. Launch before driving.']
  }
  if (!input.ourPidAlive) {
    return ['stale: run.json exists but the recorded pid is gone']
  }
  return [`ours: run ${input.runState.runId} (${input.runState.mode}) is alive`]
}

const serializeRunState = ({ ourPidAlive, runState }) => {
  if (runState === null) {
    return null
  }
  const snapshot = {
    alive: ourPidAlive,
    artifactDir: runState.artifactDir,
    mode: runState.mode,
    pid: runState.pid,
    runId: runState.runId,
  }
  return snapshot
}

const inspectSurface = async (surface) => {
  const listening = surface.isFleet
    ? false
    : await portIsListening(surface.port)
  const page = await fetchText(`${surface.origin}${surface.path}`)
  const inspection = {
    headingFound: page.body.includes(surface.heading),
    listening: surface.isFleet ? page.status > 0 : listening,
    name: surface.name,
    origin: surface.origin,
    status: page.status,
    worthDriving: page.ok && page.body.includes(surface.heading),
  }
  return inspection
}

const inspectAgent = async (entry) => {
  const [name, origin] = entry
  const page = await fetchText(`${origin}/eve/v1/health`)
  const agent = {
    name,
    origin,
    status: page.status,
    worthDriving: page.ok,
  }
  return agent
}

const inspectAgents = (fleetSource) =>
  Promise.all(Object.entries(AGENT_ORIGINS(fleetSource)).map(inspectAgent))

const main = async () => {
  const runState = readRunState()
  const isFleet = runState !== null && runState.mode === 'fleet'
  const fleetSource = {
    PORTLESS_PROXY_PORT:
      process.env.PORTLESS_PROXY_PORT ??
      process.env.PORTLESS_HTTPS_PORT ??
      readRunningProxyPort() ??
      '1355',
  }
  const webOrigin = isFleet ? fleetWebOrigin(fleetSource) : WEB_ORIGIN
  const appOrigin = isFleet ? fleetAppOrigin(fleetSource) : APP_ORIGIN
  const web = await inspectSurface({
    heading: LANDING_HEADING,
    isFleet,
    name: 'web',
    origin: webOrigin,
    path: '/',
    port: WEB_PORT,
  })
  const app = await inspectSurface({
    heading: SIGN_IN_HEADING,
    isFleet,
    name: 'app',
    origin: appOrigin,
    path: '/sign-in',
    port: APP_PORT,
  })
  const agents = isFleet ? await inspectAgents(fleetSource) : []
  const ourPidAlive = runState === null ? false : processIsAlive(runState.pid)
  const webIsOurs =
    ourPidAlive && (runState.mode === 'web' || runState.mode === 'fleet')
  const appIsOurs = ourPidAlive && runState.mode === 'fleet'
  const webForeign = web.listening && !webIsOurs
  const appForeign = app.listening && !appIsOurs
  const isolation = isolationMessages({
    appForeign,
    appOrigin,
    isFleet,
    ourPidAlive,
    runState,
    webForeign,
    webOrigin,
  })
  const report = {
    agents,
    app: {
      ...app,
      drive: driveStatus({
        foreign: appForeign,
        worthDriving: app.worthDriving,
      }),
    },
    isolation,
    ok: webIsOurs && web.worthDriving && !webForeign,
    runState: serializeRunState({ ourPidAlive, runState }),
    web: {
      ...web,
      drive: driveStatus({
        foreign: webForeign,
        worthDriving: web.worthDriving,
      }),
    },
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = report.ok ? 0 : 1
}

await main()
