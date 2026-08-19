import { readFileSync, rmSync, writeFileSync } from 'node:fs'

import { ensureEvidenceRoot, RUN_STATE_PATH } from './paths.mjs'

export const readRunState = () => {
  try {
    return JSON.parse(readFileSync(RUN_STATE_PATH, 'utf8'))
  } catch {
    return null
  }
}

export const writeRunState = (state) => {
  ensureEvidenceRoot()
  writeFileSync(RUN_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
  return RUN_STATE_PATH
}

export const clearRunState = () => {
  rmSync(RUN_STATE_PATH, { force: true })
}

export const processIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
