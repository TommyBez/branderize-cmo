import { readdirSync } from 'node:fs'

import { channelPlanContentSchema } from '@repo/brain/objects'
import { describe, expect, it } from 'vitest'

import rootAgent from './agent'
import { ROOT_RUNTIME_CONTRACT } from './lib/root-contract'
import { finishTaskInputSchema } from './tools/finish_task'

describe('Distribution root runtime', () => {
  it('uses the channel plan kind and public Eve health route', () => {
    expect(ROOT_RUNTIME_CONTRACT).toMatchObject({
      agentKey: 'distribution',
      functional: true,
      health: { method: 'GET', path: '/eve/v1/health', public: true },
      role: 'specialist',
    })
    expect(ROOT_RUNTIME_CONTRACT.dispatch.claimableTaskKinds).toEqual([
      'distribution.channel-plan.v1',
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

  it('keeps trusted task and Object identifiers out of model tool inputs', () => {
    const plan = {
      channels: [{ name: 'LinkedIn', purpose: 'Reach operators' }],
      sequence: ['Publish the brief first'],
      summary: 'Start with one owned channel.',
    }
    expect(channelPlanContentSchema.safeParse(plan).success).toBe(true)
    expect(
      channelPlanContentSchema.safeParse({
        ...plan,
        taskId: '00000000-0000-4000-8000-000000000204',
      }).success
    ).toBe(false)
    expect(
      finishTaskInputSchema.safeParse({
        reportObjectId: '00000000-0000-0000-0000-000000000202',
        status: 'completed',
        summary: 'Channel plan drafted.',
      }).success
    ).toBe(false)
    expect(
      finishTaskInputSchema.safeParse({
        status: 'completed',
        summary: 'Channel plan drafted.',
      }).success
    ).toBe(true)
  })
})
