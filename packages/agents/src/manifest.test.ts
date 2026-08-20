import { describe, expect, it } from 'vitest'

import { getRootManifest, rootManifest } from './manifest'
import { AGENT_KEYS } from './registry'

describe('compiled root manifest', () => {
  it('contains every root exactly once in canonical order', () => {
    expect(rootManifest.map(({ agentKey }) => agentKey)).toEqual(AGENT_KEYS)
  })

  it('exposes each functional specialist kind only from its owning root', () => {
    expect(getRootManifest('product-marketer').supportedTaskKinds).toEqual([
      'product-marketer.brand-context.v1',
    ])
    expect(getRootManifest('content').supportedTaskKinds).toEqual([
      'content.brief.v1',
    ])
    expect(getRootManifest('distribution').supportedTaskKinds).toEqual([
      'distribution.channel-plan.v1',
    ])
    expect(getRootManifest('seo-discovery').supportedTaskKinds).toEqual([
      'seo-discovery.opportunity.v1',
    ])

    for (const agentKey of ['cmo', 'lifecycle', 'growth'] as const) {
      expect(getRootManifest(agentKey).supportedTaskKinds).toEqual([])
    }
  })
})
