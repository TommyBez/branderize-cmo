import { describe, expect, it } from 'vitest'

import {
  getTaskKind,
  LATERAL_WORK_EDGES,
  LATERAL_WORK_TARGET_KIND_KEYS,
  resolveLateralWorkEdge,
} from './registry'
import {
  buildDistributionChannelPlanTaskPrompt,
  CONTENT_WORKER_KEY,
  DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
  DISTRIBUTION_WORKER_KEY,
  distributionChannelPlanClaimContextSchema,
  distributionChannelPlanPayloadSchema,
} from './tasks'

const SOURCE_REPORT_OBJECT_ID = '00000000-0000-4000-8000-000000000202'

describe('Distribution channel plan payload', () => {
  it('keeps the CMO purpose-only shape and accepts an optional source report', () => {
    expect(
      distributionChannelPlanPayloadSchema.parse({
        purpose: 'draft_channel_plan',
      })
    ).toEqual({ purpose: 'draft_channel_plan' })
    expect(
      distributionChannelPlanPayloadSchema.parse({
        purpose: 'draft_channel_plan',
        sourceReportObjectId: SOURCE_REPORT_OBJECT_ID,
      })
    ).toEqual({
      purpose: 'draft_channel_plan',
      sourceReportObjectId: SOURCE_REPORT_OBJECT_ID,
    })
    expect(
      distributionChannelPlanPayloadSchema.safeParse({
        brandId: 'brand_injected',
        purpose: 'draft_channel_plan',
      }).success
    ).toBe(false)
  })

  it('uses distinct subject keys for CMO and lateral channel plans', () => {
    const taskKind = getTaskKind(DISTRIBUTION_CHANNEL_PLAN_TASK_KIND)
    expect(taskKind.subjectKey({ purpose: 'draft_channel_plan' })).toBe(
      `${DISTRIBUTION_WORKER_KEY}:channel-plan`
    )
    expect(
      taskKind.subjectKey({
        purpose: 'draft_channel_plan',
        sourceReportObjectId: SOURCE_REPORT_OBJECT_ID,
      })
    ).toBe(`${DISTRIBUTION_WORKER_KEY}:channel-plan:${SOURCE_REPORT_OBJECT_ID}`)
  })

  it('accepts Brand Context alone or next to a source report', () => {
    expect(
      distributionChannelPlanClaimContextSchema.parse({
        brandContextContent: { summary: 'Current context' },
        brandContextObjectId: 'object_brand_context_01',
      })
    ).toEqual({
      brandContextContent: { summary: 'Current context' },
      brandContextObjectId: 'object_brand_context_01',
    })
    expect(
      distributionChannelPlanClaimContextSchema.parse({
        brandContextContent: { summary: 'Current context' },
        brandContextObjectId: 'object_brand_context_01',
        sourceReportContent: { title: 'Homepage brief' },
        sourceReportObjectId: SOURCE_REPORT_OBJECT_ID,
      })
    ).toMatchObject({
      sourceReportObjectId: SOURCE_REPORT_OBJECT_ID,
    })
    expect(
      buildDistributionChannelPlanTaskPrompt({
        claimContext: {
          brandContextContent: { summary: 'Current context' },
          brandContextObjectId: 'object_brand_context_01',
          sourceReportContent: { title: 'Homepage brief' },
          sourceReportObjectId: SOURCE_REPORT_OBJECT_ID,
        },
        intentSnapshot: {
          acceptance_criteria: [{ metric: 'qualified demand' }],
          brand_id: '00000000-0000-0000-0000-000000000201',
          constraints: null,
          intent_id: '00000000-0000-0000-0000-000000000203',
          intent_revision: 1,
          preauthorizations: [],
          statement: 'Publish the homepage brief',
        },
        kind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
        payload: {
          purpose: 'draft_channel_plan',
          sourceReportObjectId: SOURCE_REPORT_OBJECT_ID,
        },
      })
    ).toContain('Homepage brief')
  })
})

describe('lateral work edges', () => {
  it('registers exactly the Content to Distribution channel-plan edge', () => {
    expect(LATERAL_WORK_EDGES).toEqual([
      {
        sourceWorkerKey: CONTENT_WORKER_KEY,
        targetKind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
        targetWorkerKey: DISTRIBUTION_WORKER_KEY,
      },
    ])
    expect(LATERAL_WORK_TARGET_KIND_KEYS).toEqual([
      DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
    ])
    expect(
      resolveLateralWorkEdge({
        sourceWorkerKey: CONTENT_WORKER_KEY,
        targetKind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
      })
    ).toEqual(LATERAL_WORK_EDGES[0])
    expect(
      resolveLateralWorkEdge({
        sourceWorkerKey: CONTENT_WORKER_KEY,
        targetKind: 'seo-discovery.opportunity.v1',
      })
    ).toBeNull()
    expect(
      resolveLateralWorkEdge({
        sourceWorkerKey: 'product-marketer',
        targetKind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
      })
    ).toBeNull()
  })
})
