import type { DynamicResolveContext } from 'eve'
import { describe, expect, it, vi } from 'vitest'

import { createEveModelConfig, withGatewayAttribution } from './model-config'
import { getModelProfile } from './registry'

const createContext = (
  initiatorBrandId: string | null,
  currentBrandId: string | null = initiatorBrandId
): DynamicResolveContext => ({
  channel: { kind: 'test' },
  messages: [],
  session: {
    auth: {
      current:
        currentBrandId === null
          ? null
          : {
              attributes: { brand_id: currentBrandId },
              authenticator: 'fixture',
              principalId: 'principal_fixture',
              principalType: 'service',
            },
      initiator:
        initiatorBrandId === null
          ? null
          : {
              attributes: { brand_id: initiatorBrandId },
              authenticator: 'fixture',
              principalId: 'principal_fixture',
              principalType: 'service',
            },
    },
    id: 'session_fixture',
  },
})

describe('Eve model config factory', () => {
  it('merges provider options and replaces reserved attribution', () => {
    const profile = getModelProfile('deepseek-v4-pro-0813')
    if (profile === null) {
      throw new Error('Expected the Phase 0 profile')
    }

    const selection = withGatewayAttribution({
      agentKey: 'cmo',
      brandId: 'brand_fixture',
      environment: 'test',
      lane: 'cmo',
      profile: {
        ...profile,
        modelOptions: {
          providerOptions: {
            gateway: {
              order: ['provider-a'],
              tags: ['agent:injected', 'custom:retained'],
              user: 'injected',
            },
            providerA: { cache: true },
          },
        },
      },
    })

    expect(selection.modelOptions.providerOptions?.providerA).toEqual({
      cache: true,
    })
    expect(selection.modelOptions.providerOptions?.gateway).toEqual({
      order: ['provider-a'],
      tags: [
        'agent:cmo',
        'custom:retained',
        'env:test',
        'feature:conversation',
        'lane:cmo',
      ],
      user: 'brand_fixture',
    })
  })

  it('selects once at session start and uses the trusted brand override', async () => {
    const loadActiveBrandProfileKey = vi.fn(() =>
      Promise.resolve('deepseek-v4-pro-0813')
    )
    const modelConfig = createEveModelConfig(
      {
        agentKey: 'product-marketer',
        environment: 'test',
        lane: 'task',
      },
      { loadActiveBrandProfileKey }
    )
    const resolveAtSessionStart = modelConfig.events['session.started']
    if (resolveAtSessionStart === undefined) {
      throw new Error('Expected a session-scoped resolver')
    }

    const selection = await resolveAtSessionStart(
      {},
      createContext('brand_fixture')
    )

    expect(loadActiveBrandProfileKey).toHaveBeenCalledOnce()
    expect(loadActiveBrandProfileKey).toHaveBeenCalledWith(
      'brand_fixture',
      'product-marketer'
    )
    expect(selection).toMatchObject({
      model: 'deepseek/deepseek-v4-pro-0813',
      modelContextWindowTokens: 1_000_000,
    })
  })

  it('uses the global runtime profile when override lookup fails', async () => {
    const onFallback = vi.fn()
    const modelConfig = createEveModelConfig(
      { agentKey: 'cmo', environment: 'test', lane: 'cmo' },
      {
        loadActiveBrandProfileKey: () =>
          Promise.reject(new Error('database unavailable')),
        onFallback,
      }
    )
    const resolveAtSessionStart = modelConfig.events['session.started']
    if (resolveAtSessionStart === undefined) {
      throw new Error('Expected a session-scoped resolver')
    }

    const selection = await resolveAtSessionStart(
      {},
      createContext('brand_fixture')
    )

    expect(selection).toMatchObject({
      model: 'deepseek/deepseek-v4-pro-0813',
      modelContextWindowTokens: 1_000_000,
    })
    expect(onFallback).toHaveBeenCalledWith({
      agentKey: 'cmo',
      brandId: 'brand_fixture',
      reason: 'override_lookup_failed',
    })
  })

  it('does not attach a Gateway user when trusted brand auth is missing', async () => {
    const onFallback = vi.fn()
    const modelConfig = createEveModelConfig(
      { agentKey: 'cmo', environment: 'test', lane: 'cmo' },
      { onFallback }
    )
    const resolveAtSessionStart = modelConfig.events['session.started']
    if (resolveAtSessionStart === undefined) {
      throw new Error('Expected a session-scoped resolver')
    }

    const selection = await resolveAtSessionStart({}, createContext(null))

    expect(selection).toMatchObject({
      model: 'deepseek/deepseek-v4-pro-0813',
      modelContextWindowTokens: 1_000_000,
    })
    expect(onFallback).toHaveBeenCalledWith({
      agentKey: 'cmo',
      brandId: null,
      reason: 'missing_trusted_brand',
    })
  })
})
