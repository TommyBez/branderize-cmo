import { describe, expect, it } from 'vitest'

import {
  requestSpecialistWorkInputSchema,
  resolveTaskQuestionsInputSchema,
} from './tasks'

const intentId = '018f47a6-72d3-7a93-b49a-d91f50dd1771'
const taskId = '018f47a6-72d3-7a93-b49a-d91f50dd1882'

describe('Product Marketer task inputs', () => {
  it('accepts registered specialist kinds and rejects unpublished ones', () => {
    const parsed = requestSpecialistWorkInputSchema.parse({
      intentId,
      kind: 'product-marketer.brand-context.v1',
      payload: { purpose: 'enrich_brand_context' },
      requestId: 'task-request-1',
    })
    expect(parsed.kind).toBe('product-marketer.brand-context.v1')
    expect(
      requestSpecialistWorkInputSchema.parse({
        intentId,
        kind: 'content.brief.v1',
        payload: { purpose: 'draft_content_brief' },
        requestId: 'task-request-2',
      }).kind
    ).toBe('content.brief.v1')
    expect(
      requestSpecialistWorkInputSchema.parse({
        intentId,
        kind: 'distribution.channel-plan.v1',
        payload: { purpose: 'draft_channel_plan' },
        requestId: 'task-request-3',
      }).kind
    ).toBe('distribution.channel-plan.v1')
    expect(
      requestSpecialistWorkInputSchema.parse({
        intentId,
        kind: 'seo-discovery.opportunity.v1',
        payload: { purpose: 'draft_seo_opportunity' },
        requestId: 'task-request-4',
      }).kind
    ).toBe('seo-discovery.opportunity.v1')
    expect(() =>
      requestSpecialistWorkInputSchema.parse({
        ...parsed,
        kind: 'content.publish.v1',
      })
    ).toThrow()
  })

  it.each([
    {
      disposition: 'answered' as const,
      rationale: 'The human answered the complete immutable bundle.',
    },
    {
      disposition: 'no_longer_relevant' as const,
      rationale: 'The human confirmed that the bundle is obsolete.',
    },
  ])('accepts the closed $disposition disposition', (resolution) => {
    expect(
      resolveTaskQuestionsInputSchema.parse({
        ...resolution,
        requestId: 'questions-1',
        taskId,
      })
    ).toMatchObject(resolution)
  })

  it('rejects incomplete, open, or answer-copy resolution shapes', () => {
    expect(() =>
      resolveTaskQuestionsInputSchema.parse({
        disposition: 'answered',
        rationale: '',
        requestId: 'questions-2',
        taskId,
      })
    ).toThrow()
    expect(() =>
      resolveTaskQuestionsInputSchema.parse({
        disposition: 'pending',
        rationale: 'The bundle still needs an answer.',
        requestId: 'questions-3',
        taskId,
      })
    ).toThrow()
    expect(() =>
      resolveTaskQuestionsInputSchema.parse({
        answers: ['Duplicated transcript content'],
        disposition: 'answered',
        rationale: 'The human answered the complete immutable bundle.',
        requestId: 'questions-4',
        taskId,
      })
    ).toThrow()
  })

  it('keeps request identity separate from the normalized closure bundle', () => {
    const first = resolveTaskQuestionsInputSchema.parse({
      disposition: 'no_longer_relevant',
      rationale: ' The launch window has passed. ',
      requestId: 'questions:first',
      taskId,
    })
    const retry = resolveTaskQuestionsInputSchema.parse({
      ...first,
      requestId: 'questions:retry',
    })

    expect({
      disposition: retry.disposition,
      rationale: retry.rationale,
      taskId: retry.taskId,
    }).toEqual({
      disposition: first.disposition,
      rationale: first.rationale,
      taskId: first.taskId,
    })
    expect(first.rationale).toBe('The launch window has passed.')
    expect(retry.requestId).not.toBe(first.requestId)
  })
})
