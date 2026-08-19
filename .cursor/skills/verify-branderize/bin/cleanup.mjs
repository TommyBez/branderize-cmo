#!/usr/bin/env node

import {
  clearRunState,
  processIsAlive,
  readRunState,
} from '../lib/run-state.mjs'

const SHUTDOWN_GRACE_MS = 4000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const signalTree = (pid, signal) => {
  try {
    process.kill(-pid, signal)
    return
  } catch {
    // Fall through to the single pid when the process is not a group leader.
  }

  try {
    process.kill(pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error
    }
  }
}

const state = readRunState()
if (state === null) {
  process.stdout.write('No verify run.json found. Nothing to stop.\n')
  process.exit(0)
}

if (!processIsAlive(state.pid)) {
  clearRunState()
  process.stdout.write(
    `Recorded pid ${String(state.pid)} is already gone. Cleared run.json. Evidence at ${state.artifactDir} is unchanged.\n`
  )
  process.exit(0)
}

signalTree(state.pid, 'SIGTERM')
await sleep(SHUTDOWN_GRACE_MS)
if (processIsAlive(state.pid)) {
  signalTree(state.pid, 'SIGKILL')
}

clearRunState()
process.stdout.write(
  `Stopped run ${state.runId} (pid ${String(state.pid)}). Evidence remains at ${state.artifactDir}.\n`
)
