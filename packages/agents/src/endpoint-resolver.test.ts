import { describe, expect, it } from 'vitest'

import {
  type AgentEndpointMap,
  createAgentEndpointResolver,
} from './endpoint-resolver'

const endpoints = {
  cmo: 'https://cmo.example.test/root-0/',
  content: 'https://content.example.test/root-1/',
  distribution: 'https://distribution.example.test/root-2/',
  growth: 'https://growth.example.test/root-6/',
  lifecycle: 'https://lifecycle.example.test/root-5/',
  'product-marketer': 'https://product-marketer.example.test/root-3/',
  'seo-discovery': 'https://seo-discovery.example.test/root-4/',
} satisfies AgentEndpointMap

describe('agent endpoint resolver', () => {
  it('resolves the compiled endpoint for a trusted brand lookup', () => {
    const resolveEndpoint = createAgentEndpointResolver(endpoints)

    expect(resolveEndpoint({ agentKey: 'cmo', brandId: 'brand_fixture' })).toBe(
      'https://cmo.example.test/root-0'
    )
  })

  it('rejects caller-authored endpoint overrides', () => {
    const resolveEndpoint = createAgentEndpointResolver(endpoints)

    expect(() =>
      resolveEndpoint({
        agentKey: 'cmo',
        brandId: 'brand_fixture',
        endpoint: 'https://attacker.example',
      })
    ).toThrow()
  })

  it('rejects insecure non-local endpoints at compile time', () => {
    expect(() =>
      createAgentEndpointResolver({
        ...endpoints,
        cmo: 'http://cmo.example.test',
      })
    ).toThrow('Agent endpoints must use HTTPS outside local development')
  })
})
