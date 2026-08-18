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
  productMarketerCompletionSchema,
  productMarketerPayloadSchema,
} from './tasks'

describe('Phase 0 agent registry', () => {
  it('declares seven roots and only two functional entries', () => {
    expect(AGENT_KEYS.map((agentKey) => agentRegistry[agentKey].key)).toEqual(
      AGENT_KEYS
    )
    expect(
      Object.values(agentRegistry)
        .filter(({ status }) => status === 'functional')
        .map(({ key }) => key)
    ).toEqual(['cmo', 'product-marketer'])
  })

  it('keeps every default on an exact registered profile', () => {
    for (const agent of Object.values(agentRegistry)) {
      expect(modelProfiles).toHaveProperty(agent.defaultModelProfileKey)
    }
  })

  it('registers the closed Product Marketer task contract', () => {
    expect(Object.keys(taskKindRegistry)).toEqual([
      'product-marketer.brand-context.v1',
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
      'product-marketer.brand-context.v1',
    ])
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
