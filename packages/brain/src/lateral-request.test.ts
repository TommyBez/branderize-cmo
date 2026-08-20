import { describe, expect, it } from 'vitest'

import type { TrustedTaskExecution } from './context'
import { BrainError } from './errors'
import { requestLateralWork } from './lateral-request'
import { requestLateralWorkInputSchema } from './task-contracts'

const intentId = '018f47a6-72d3-7a93-b49a-d91f50dd1771'
const reportObjectId = '018f47a6-72d3-7a93-b49a-d91f50dd1993'
const unusedDatabase = {} as never

const contentExecution: TrustedTaskExecution = {
  agentActorId: '00000000-0000-0000-0000-000000000103',
  agentActorKey: 'agent:content',
  brandId: '00000000-0000-0000-0000-000000000201',
  rootSessionId: 'session-content-root',
  sessionId: 'session-content-root',
  startedAt: new Date('2026-08-20T10:00:00.000Z'),
  taskId: '00000000-0000-4000-8000-000000000301',
  workerKey: 'content',
}

const validLateralInput = {
  kind: 'distribution.channel-plan.v1' as const,
  payload: {
    purpose: 'draft_channel_plan' as const,
    sourceReportObjectId: reportObjectId,
  },
  rationale: 'Turn the Content report into a channel plan.',
  requestId: 'lateral-request-1',
}

describe('requestLateralWork input', () => {
  it('accepts a Distribution channel plan with a source report Object id', () => {
    expect(requestLateralWorkInputSchema.parse(validLateralInput)).toEqual(
      validLateralInput
    )
  })

  it('rejects unpublished kinds and injected authority fields', () => {
    expect(() =>
      requestLateralWorkInputSchema.parse({
        ...validLateralInput,
        kind: 'content.publish.v1',
      })
    ).toThrow()
    expect(
      requestLateralWorkInputSchema.safeParse({
        ...validLateralInput,
        brandId: contentExecution.brandId,
      }).success
    ).toBe(false)
    expect(
      requestLateralWorkInputSchema.safeParse({
        ...validLateralInput,
        intentId,
      }).success
    ).toBe(false)
    expect(
      requestLateralWorkInputSchema.safeParse({
        ...validLateralInput,
        parentTaskId: contentExecution.taskId,
      }).success
    ).toBe(false)
    expect(
      requestLateralWorkInputSchema.safeParse({
        ...validLateralInput,
        workerKey: 'distribution',
      }).success
    ).toBe(false)
  })
})

describe('requestLateralWork fail-closed gates', () => {
  it('rejects an edge miss before opening a transaction', async () => {
    await expect(
      requestLateralWork({
        access: contentExecution,
        database: unusedDatabase,
        input: {
          kind: 'seo-discovery.opportunity.v1',
          payload: { purpose: 'draft_seo_opportunity' },
          rationale: 'Ask SEO Discovery from Content.',
          requestId: 'lateral-edge-miss',
        },
      })
    ).rejects.toMatchObject({
      code: 'unsupported_task_kind',
      name: BrainError.name,
    })
  })

  it('rejects a child session before opening a transaction', async () => {
    await expect(
      requestLateralWork({
        access: {
          ...contentExecution,
          sessionId: 'session-content-child',
        },
        database: unusedDatabase,
        input: validLateralInput,
      })
    ).rejects.toMatchObject({
      code: 'invalid_task',
      name: BrainError.name,
    })
  })

  it('rejects a channel plan without a source report Object id', async () => {
    await expect(
      requestLateralWork({
        access: contentExecution,
        database: unusedDatabase,
        input: {
          kind: 'distribution.channel-plan.v1',
          payload: { purpose: 'draft_channel_plan' },
          rationale: 'Request a channel plan without a report.',
          requestId: 'lateral-missing-report',
        },
      })
    ).rejects.toMatchObject({
      code: 'invalid_task',
      name: BrainError.name,
    })
  })
})
