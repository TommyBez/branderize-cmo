import { readdirSync } from 'node:fs'

import { resolveDeploymentEnvironment } from '@repo/agents/root-runtime'
import { productMarketerContextContentSchema } from '@repo/brain/objects'
import { describe, expect, it } from 'vitest'

import rootAgent from './agent'
import { ROOT_RUNTIME_CONTRACT } from './lib/root-contract'
import { finishTaskInputSchema } from './tools/finish_task'

describe('Product Marketer root runtime', () => {
  it('uses the sole Phase 0 task kind and public Eve health route', () => {
    expect(ROOT_RUNTIME_CONTRACT).toMatchObject({
      agentKey: 'product-marketer',
      functional: true,
      health: { method: 'GET', path: '/eve/v1/health', public: true },
      role: 'specialist',
    })
    expect(ROOT_RUNTIME_CONTRACT.dispatch.claimableTaskKinds).toEqual([
      'product-marketer.brand-context.v1',
    ])
  })

  it('uses high reasoning without a custom compaction threshold', () => {
    expect(rootAgent.reasoning).toBe('high')
    expect(rootAgent).not.toHaveProperty('compaction')
  })

  it('enables Eve native self-copy without an authored agent override', () => {
    expect(readdirSync(new URL('./tools/', import.meta.url))).not.toContain(
      'agent.ts'
    )
  })

  it('maps deployment environments without accepting arbitrary values', () => {
    expect(resolveDeploymentEnvironment({ NODE_ENV: 'test' })).toBe('test')
    expect(
      resolveDeploymentEnvironment({
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
      })
    ).toBe('preview')
    expect(resolveDeploymentEnvironment({ NODE_ENV: 'production' })).toBe(
      'production'
    )
    expect(resolveDeploymentEnvironment({ VERCEL_ENV: 'unknown' })).toBe(
      'development'
    )
  })

  it('keeps trusted task and Object identifiers out of model tool inputs', () => {
    const brandContext = {
      audiences: [{ need: 'Make demand more qualified', segment: 'CMOs' }],
      category: 'Marketing operating system',
      differentiators: ['Canonical provenance'],
      risks: [],
      summary: 'A CMO-led marketing operating system.',
      valueProposition: 'Turn explicit intent into governed marketing work.',
    }
    expect(
      productMarketerContextContentSchema.safeParse(brandContext).success
    ).toBe(true)
    expect(
      productMarketerContextContentSchema.safeParse({
        ...brandContext,
        taskId: '00000000-0000-4000-8000-000000000204',
      }).success
    ).toBe(false)
    expect(
      finishTaskInputSchema.safeParse({
        brandContextObjectId: '00000000-0000-0000-0000-000000000202',
        status: 'completed',
        summary: 'Brand Context enriched.',
      }).success
    ).toBe(false)
    expect(
      finishTaskInputSchema.safeParse({
        status: 'completed',
        summary: 'Brand Context enriched.',
      }).success
    ).toBe(true)
  })
})
