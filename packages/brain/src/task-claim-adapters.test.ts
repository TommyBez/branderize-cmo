import { REGISTERED_TASK_KIND_KEYS } from '@repo/agents'
import { describe, expect, it } from 'vitest'

import { claimContextAdapters } from './task-claim-adapters'

describe('claim context adapters', () => {
  it('registers exactly one adapter per registered task kind', () => {
    expect(Object.keys(claimContextAdapters)).toEqual([
      ...REGISTERED_TASK_KIND_KEYS,
    ])
  })
})
