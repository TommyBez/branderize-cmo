import { readdirSync } from 'node:fs'

import { contentBriefContentSchema } from '@repo/brain/objects'
import { describe, expect, it } from 'vitest'

import rootAgent from './agent'
import { ROOT_RUNTIME_CONTRACT } from './lib/root-contract'
import { finishTaskInputSchema } from './tools/finish_task'

describe('Content root runtime', () => {
  it('uses the Content brief kind and public Eve health route', () => {
    expect(ROOT_RUNTIME_CONTRACT).toMatchObject({
      agentKey: 'content',
      functional: true,
      health: { method: 'GET', path: '/eve/v1/health', public: true },
      role: 'specialist',
    })
    expect(ROOT_RUNTIME_CONTRACT.dispatch.claimableTaskKinds).toEqual([
      'content.brief.v1',
      'content.notion-page.v1',
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
    expect(readdirSync(new URL('./tools/', import.meta.url))).toContain(
      'request_lateral_work.ts'
    )
  })

  it('keeps trusted task and Object identifiers out of model tool inputs', () => {
    const brief = {
      audience: 'CMOs',
      channels: ['site'],
      outline: ['Open with the Intent'],
      summary: 'A brief for the homepage.',
      title: 'Homepage brief',
    }
    expect(contentBriefContentSchema.safeParse(brief).success).toBe(true)
    expect(
      contentBriefContentSchema.safeParse({
        ...brief,
        taskId: '00000000-0000-4000-8000-000000000204',
      }).success
    ).toBe(false)
    expect(
      finishTaskInputSchema.safeParse({
        reportObjectId: '00000000-0000-0000-0000-000000000202',
        status: 'completed',
        summary: 'Content brief drafted.',
      }).success
    ).toBe(false)
    expect(
      finishTaskInputSchema.safeParse({
        status: 'completed',
        summary: 'Content brief drafted.',
      }).success
    ).toBe(true)
  })
})
