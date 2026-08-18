import { describe, expect, it } from 'vitest'

import { getRootManifest, rootManifest } from './manifest'
import { AGENT_KEYS } from './registry'

describe('compiled root manifest', () => {
  it('contains every root exactly once in canonical order', () => {
    expect(rootManifest.map(({ agentKey }) => agentKey)).toEqual(AGENT_KEYS)
  })

  it('exposes Product Marketer work only from its owning root', () => {
    expect(getRootManifest('product-marketer').supportedTaskKinds).toEqual([
      'product-marketer.brand-context.v1',
    ])

    for (const agentKey of AGENT_KEYS) {
      if (agentKey !== 'product-marketer') {
        expect(getRootManifest(agentKey).supportedTaskKinds).toEqual([])
      }
    }
  })
})
