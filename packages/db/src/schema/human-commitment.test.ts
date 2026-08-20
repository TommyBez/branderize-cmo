import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const TOKEN_LIKE_PATTERN =
  /(?:access|refresh|id)_token|api[_-]?key|client_secret/iu

const migration = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../drizzle/0002_human_commitment_lane.sql'
  ),
  'utf8'
)

describe('human commitment lane checks', () => {
  it('adds only the four ADR-019 lane-wide CHECKs', () => {
    expect(migration).toContain('tasks_human_approval_required_from_queued')
    expect(migration).toContain('tasks_human_approved_at_pair')
    expect(migration).toContain('tasks_human_conflict_key_null_while_awaiting')
    expect(migration).toContain('tasks_human_result_required_on_terminal')
    expect(migration).not.toContain('action_charge')
    expect(migration).not.toMatch(TOKEN_LIKE_PATTERN)
  })
})
