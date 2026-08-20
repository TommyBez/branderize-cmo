import { taskGenerationOf } from '@repo/brain/tasks'
import { describe, expect, it } from 'vitest'

import {
  agentClaimableKindsOf,
  drainDirectHumanCommitments,
  humanCommitmentKindsOf,
} from './direct-drain'

const CLAIM = {
  agentActorId: '00000000-0000-0000-0000-000000000103',
  agentActorKey: 'agent:content' as const,
  approvalActionId: '00000000-0000-4000-8000-000000000301',
  brandId: '00000000-0000-0000-0000-000000000201',
  kind: 'content.notion-page.v1' as const,
  payload: {
    reportObjectId: '00000000-0000-4000-8000-000000000202',
    title: 'Launch page',
  },
  startedAt: taskGenerationOf(new Date('2026-08-20T10:00:00.000Z')),
  taskId: '00000000-0000-4000-8000-000000000204',
  workerKey: 'content' as const,
}

describe('direct human drain', () => {
  it('splits Content kinds into the human lane and the agent lane', () => {
    expect(
      humanCommitmentKindsOf(['content.brief.v1', 'content.notion-page.v1'])
    ).toEqual(['content.notion-page.v1'])
    expect(
      agentClaimableKindsOf(['content.brief.v1', 'content.notion-page.v1'])
    ).toEqual(['content.brief.v1'])
  })

  it('claims one human row, runs the handler once, and settles', async () => {
    const handlerCalls: string[] = []
    const settled: string[] = []
    let claims = 0
    await expect(
      drainDirectHumanCommitments({
        budget: 2,
        handler: ({ claim }) => {
          handlerCalls.push(claim.taskId)
          return Promise.resolve({
            outcome: 'accepted',
            receipt: {
              accountLabel: 'Acme Notion workspace',
              pageId: 'page_scripted_01',
              pageUrl: 'https://notion.example/page_scripted_01',
            },
          })
        },
        kinds: ['content.notion-page.v1'],
        lifecycle: {
          claimNextDue: () => {
            claims += 1
            return Promise.resolve(
              claims === 1
                ? { claim: CLAIM, outcome: 'claimed' }
                : { outcome: 'empty' }
            )
          },
          settleResult: ({ claim }) => {
            settled.push(claim.taskId)
            return Promise.resolve({
              actionId: '00000000-0000-4000-8000-000000000401',
              status: 'succeeded',
              taskId: claim.taskId,
            })
          },
          settleStale: () => Promise.resolve([]),
        },
        now: () => new Date('2026-08-20T10:00:00.000Z'),
        workerKey: 'content',
      })
    ).resolves.toEqual({ claimed: 1, settled: 1 })
    expect(handlerCalls).toEqual([CLAIM.taskId])
    expect(settled).toEqual([CLAIM.taskId])
  })

  it('maps an unexpected handler throw to unknown settlement', async () => {
    const outcomes: Array<string | { readonly outcome: string }> = []
    await drainDirectHumanCommitments({
      budget: 1,
      handler: () => {
        throw new Error('handler crashed')
      },
      kinds: ['content.notion-page.v1'],
      lifecycle: {
        claimNextDue: () =>
          Promise.resolve({ claim: CLAIM, outcome: 'claimed' }),
        settleResult: ({ outcome }) => {
          outcomes.push(outcome)
          return Promise.resolve({
            actionId: '00000000-0000-4000-8000-000000000401',
            status: 'outcome_unknown',
            taskId: CLAIM.taskId,
          })
        },
        settleStale: () => Promise.resolve([]),
      },
      now: () => new Date('2026-08-20T10:00:00.000Z'),
      workerKey: 'content',
    })
    expect(outcomes).toEqual(['unexpected_throw'])
  })
})
