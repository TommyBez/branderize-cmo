import { describe, expect, it } from 'vitest'

import {
  type AgentEndpointMap,
  createAgentEndpointResolver,
  createPartialAgentEndpointResolver,
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
  it('resolves the compiled endpoint for an agent', () => {
    const resolveEndpoint = createAgentEndpointResolver(endpoints)

    expect(resolveEndpoint({ agentKey: 'cmo' })).toBe(
      'https://cmo.example.test/root-0'
    )
  })

  it('rejects caller-authored endpoint overrides', () => {
    const resolveEndpoint = createAgentEndpointResolver(endpoints)

    expect(() =>
      resolveEndpoint({
        agentKey: 'cmo',
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

describe('partial agent endpoint resolver', () => {
  const specialistEndpoints = {
    content: endpoints.content,
    distribution: endpoints.distribution,
    'product-marketer': endpoints['product-marketer'],
    'seo-discovery': endpoints['seo-discovery'],
  }

  it('resolves compiled endpoints for mapped agents', () => {
    const resolveEndpoint =
      createPartialAgentEndpointResolver(specialistEndpoints)

    expect(resolveEndpoint({ agentKey: 'content' })).toBe(
      'https://content.example.test/root-1'
    )
    expect(resolveEndpoint({ agentKey: 'product-marketer' })).toBe(
      'https://product-marketer.example.test/root-3'
    )
  })

  it('rejects an unmapped agent key', () => {
    const resolveEndpoint =
      createPartialAgentEndpointResolver(specialistEndpoints)

    expect(() => resolveEndpoint({ agentKey: 'cmo' })).toThrow(
      'No compiled endpoint for agent cmo'
    )
    expect(() => resolveEndpoint({ agentKey: 'lifecycle' })).toThrow(
      'No compiled endpoint for agent lifecycle'
    )
    expect(() => resolveEndpoint({ agentKey: 'growth' })).toThrow(
      'No compiled endpoint for agent growth'
    )
  })

  it('rejects caller-authored endpoint overrides', () => {
    const resolveEndpoint =
      createPartialAgentEndpointResolver(specialistEndpoints)

    expect(() =>
      resolveEndpoint({
        agentKey: 'content',
        endpoint: 'https://attacker.example',
      })
    ).toThrow()
  })

  it('rejects insecure non-local endpoints at compile time', () => {
    expect(() =>
      createPartialAgentEndpointResolver({
        ...specialistEndpoints,
        content: 'http://content.example.test',
      })
    ).toThrow('Agent endpoints must use HTTPS outside local development')
  })
})
