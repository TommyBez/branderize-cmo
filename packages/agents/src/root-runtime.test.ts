import { describe, expect, it } from 'vitest'

import { AGENT_KEYS } from './registry'
import {
  createRootAgentDefinition,
  createRootRuntimeContract,
  resolveDeploymentEnvironment,
} from './root-runtime'

describe('root runtime factory', () => {
  it('derives every root contract from the compiled registry', () => {
    const contracts = AGENT_KEYS.map(createRootRuntimeContract)

    expect(contracts.map(({ agentKey }) => agentKey)).toEqual(AGENT_KEYS)
    expect(contracts).toContainEqual(
      expect.objectContaining({
        agentKey: 'product-marketer',
        dispatch: expect.objectContaining({
          supportedTaskKinds: ['product-marketer.brand-context.v1'],
        }),
        functional: true,
      })
    )
    expect(
      contracts
        .filter(({ functional }) => !functional)
        .every(({ dispatch }) => dispatch.supportedTaskKinds.length === 0)
    ).toBe(true)
    for (const contract of contracts) {
      expect(contract.dispatch).toMatchObject({
        method: 'POST',
        path: '/internal/dispatch',
      })
      expect(contract.health).toEqual({
        method: 'GET',
        path: '/eve/v1/health',
        public: true,
      })
    }
  })

  it('maps deployment signals without accepting arbitrary values', () => {
    expect(resolveDeploymentEnvironment({ NODE_ENV: 'test' })).toBe('test')
    expect(
      resolveDeploymentEnvironment({
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
      })
    ).toBe('preview')
    expect(resolveDeploymentEnvironment({ VERCEL_ENV: 'production' })).toBe(
      'production'
    )
    expect(resolveDeploymentEnvironment({ NODE_ENV: 'production' })).toBe(
      'production'
    )
    expect(resolveDeploymentEnvironment({ VERCEL_ENV: 'unknown' })).toBe(
      'development'
    )
  })

  it('builds the common high-reasoning agent definition', () => {
    const definition = createRootAgentDefinition({
      agentKey: 'cmo',
      environment: 'test',
      lane: 'cmo',
    })

    expect(definition.reasoning).toBe('high')
    expect(definition).not.toHaveProperty('compaction')
  })
})
