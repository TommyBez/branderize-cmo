import { describe, expect, it } from 'vitest'

import {
  AGENT_KEYS,
  agentRegistry,
  getTaskKind,
  modelProfiles,
  REGISTERED_QUESTION_TASK_KIND_KEYS,
  taskKindRegistry,
} from './registry'
import {
  contentBriefCompletionSchema,
  contentBriefPayloadSchema,
  distributionChannelPlanCompletionSchema,
  productMarketerCompletionSchema,
  productMarketerPayloadSchema,
  seoDiscoveryOpportunityCompletionSchema,
} from './tasks'

describe('Phase 0 agent registry', () => {
  it('declares seven roots and five functional entries', () => {
    expect(AGENT_KEYS.map((agentKey) => agentRegistry[agentKey].key)).toEqual(
      AGENT_KEYS
    )
    expect(
      Object.values(agentRegistry)
        .filter(({ status }) => status === 'functional')
        .map(({ key }) => key)
    ).toEqual([
      'cmo',
      'content',
      'distribution',
      'product-marketer',
      'seo-discovery',
    ])
  })

  it('keeps every default on an exact registered profile', () => {
    for (const agent of Object.values(agentRegistry)) {
      expect(modelProfiles).toHaveProperty(agent.defaultModelProfileKey)
    }
  })

  it('registers the closed Product Marketer task contract', () => {
    expect(Object.keys(taskKindRegistry)).toEqual([
      'product-marketer.brand-context.v1',
      'content.brief.v1',
      'distribution.channel-plan.v1',
      'seo-discovery.opportunity.v1',
    ])
    const taskKind = getTaskKind('product-marketer.brand-context.v1')
    expect(
      taskKind.briefSchema.parse({ purpose: 'enrich_brand_context' })
    ).toEqual({ purpose: 'enrich_brand_context' })
    expect(taskKind.subjectKey({ purpose: 'enrich_brand_context' })).toBe(
      'product-marketer:brand-context'
    )
    expect(
      taskKind.completionSchema.safeParse({
        intentAcceptance: null,
        openQuestions: [],
        outputObjectIds: ['object_brand_context_01'],
        result: {
          brandContextObjectId: 'object_brand_context_01',
          outcome: 'report',
        },
        status: 'completed',
        summary: 'Brand Context enriched.',
      }).success
    ).toBe(true)
    expect(
      taskKind.questionPolicy?.hasOpenQuestions({
        intentAcceptance: null,
        openQuestions: ['Which segment is the first priority?'],
        outputObjectIds: [],
        result: {
          outcome: 'needs_input',
          reason: 'missing_human_context',
        },
        status: 'partial',
        summary: 'One positioning input is missing.',
      })
    ).toBe(true)
    expect(
      taskKind.questionPolicy?.hasOpenQuestions({
        intentAcceptance: null,
        openQuestions: [],
        outputObjectIds: ['object_brand_context_01'],
        result: {
          brandContextObjectId: 'object_brand_context_01',
          outcome: 'report',
        },
        status: 'completed',
        summary: 'Brand Context enriched.',
      })
    ).toBe(false)
    expect(
      taskKind.questionPolicy?.projectOpenQuestions({
        intentAcceptance: null,
        openQuestions: ['Which segment is the first priority?'],
        outputObjectIds: [],
        result: {
          outcome: 'needs_input',
          reason: 'missing_human_context',
        },
        status: 'partial',
        summary: 'One positioning input is missing.',
      })
    ).toEqual({
      questions: ['Which segment is the first priority?'],
      reason: 'missing_human_context',
      status: 'partial',
      summary: 'One positioning input is missing.',
    })
    expect(REGISTERED_QUESTION_TASK_KIND_KEYS).toEqual([
      'content.brief.v1',
      'distribution.channel-plan.v1',
      'product-marketer.brand-context.v1',
      'seo-discovery.opportunity.v1',
    ])
    expect(
      taskKind.claimContextSchema.parse({
        brandContextContent: { summary: 'Current context' },
        brandContextObjectId: 'object_brand_context_01',
      })
    ).toEqual({
      brandContextContent: { summary: 'Current context' },
      brandContextObjectId: 'object_brand_context_01',
    })
    expect(
      taskKind.buildTaskPrompt({
        claimContext: {
          brandContextContent: { summary: 'Current context' },
          brandContextObjectId: 'object_brand_context_01',
        },
        intentSnapshot: {
          acceptance_criteria: [{ metric: 'qualified demand' }],
          brand_id: '00000000-0000-0000-0000-000000000201',
          constraints: null,
          intent_id: '00000000-0000-0000-0000-000000000203',
          intent_revision: 1,
          preauthorizations: [],
          statement: 'Clarify the value proposition',
        },
        kind: 'product-marketer.brand-context.v1',
        payload: { purpose: 'enrich_brand_context' },
      })
    ).toContain('product-marketer.brand-context.v1')
  })
})

describe('Product Marketer completion', () => {
  it('accepts one completed Brand Context output', () => {
    expect(
      productMarketerCompletionSchema.parse({
        intentAcceptance: null,
        openQuestions: [],
        outputObjectIds: ['object_brand_context_01'],
        result: {
          brandContextObjectId: 'object_brand_context_01',
          outcome: 'report',
        },
        status: 'completed',
        summary: 'Brand Context enriched.',
      })
    ).toBeDefined()
  })

  it('accepts bounded questions without an Object', () => {
    expect(
      productMarketerCompletionSchema.parse({
        intentAcceptance: null,
        openQuestions: ['Which segment is the first priority?'],
        outputObjectIds: [],
        result: {
          outcome: 'needs_input',
          reason: 'missing_human_context',
        },
        status: 'partial',
        summary: 'One positioning input is missing.',
      })
    ).toBeDefined()
  })

  it('rejects extra payload authority and mismatched output ids', () => {
    expect(
      productMarketerPayloadSchema.safeParse({
        brandId: 'brand_injected',
        purpose: 'enrich_brand_context',
      }).success
    ).toBe(false)
    expect(
      productMarketerCompletionSchema.safeParse({
        intentAcceptance: null,
        openQuestions: [],
        outputObjectIds: ['object_other'],
        result: {
          brandContextObjectId: 'object_brand_context_01',
          outcome: 'report',
        },
        status: 'completed',
        summary: 'Brand Context enriched.',
      }).success
    ).toBe(false)
  })
})

describe('Phase 1 specialist completions', () => {
  it('keeps intentAcceptance null and rejects injected selectors', () => {
    expect(
      contentBriefPayloadSchema.safeParse({
        brandId: 'brand_injected',
        purpose: 'draft_content_brief',
      }).success
    ).toBe(false)
    expect(
      contentBriefCompletionSchema.parse({
        intentAcceptance: null,
        openQuestions: [],
        outputObjectIds: ['object_report_01'],
        result: { outcome: 'report', reportObjectId: 'object_report_01' },
        status: 'completed',
        summary: 'Content brief drafted.',
      }).intentAcceptance
    ).toBeNull()
    expect(
      distributionChannelPlanCompletionSchema.parse({
        intentAcceptance: null,
        openQuestions: ['Which channel is first?'],
        outputObjectIds: [],
        result: {
          outcome: 'needs_input',
          reason: 'missing_human_context',
        },
        status: 'partial',
        summary: 'Channel priority is missing.',
      }).intentAcceptance
    ).toBeNull()
    expect(
      seoDiscoveryOpportunityCompletionSchema.parse({
        intentAcceptance: null,
        openQuestions: [],
        outputObjectIds: ['object_evidence_01'],
        result: {
          evidenceObjectId: 'object_evidence_01',
          outcome: 'report',
        },
        status: 'completed',
        summary: 'SEO opportunity recorded.',
      }).result
    ).toMatchObject({ evidenceObjectId: 'object_evidence_01' })
  })
})
