import { PRODUCT_MARKETER_TASK_KIND } from '@repo/agents/tasks'
import { describe, expect, it } from 'vitest'

import { resolveRegisteredTaskKindForSettlement } from './task-settlement'

const validBinding = {
  activation: 'automatic',
  executionMode: 'agent',
  kind: PRODUCT_MARKETER_TASK_KIND,
  payload: { purpose: 'enrich_brand_context' },
  subjectKey: 'product-marketer:brand-context',
  workerKey: 'product-marketer',
} as const

describe('registered task settlement binding', () => {
  it('resolves completion behavior through the registered task kind', () => {
    const taskKind = resolveRegisteredTaskKindForSettlement(validBinding)

    expect(taskKind.kind).toBe(PRODUCT_MARKETER_TASK_KIND)
    expect(
      taskKind.completionSchema.safeParse({
        intentAcceptance: null,
        openQuestions: ['Which audience should we prioritize?'],
        outputObjectIds: [],
        result: {
          outcome: 'needs_input',
          reason: 'missing_human_context',
        },
        status: 'blocked',
        summary: 'The registered completion contract requires human input.',
      }).success
    ).toBe(true)
  })

  it.each([
    {
      binding: { ...validBinding, kind: 'content.publish.v1' },
      label: 'unregistered kind',
    },
    {
      binding: { ...validBinding, workerKey: 'content' },
      label: 'mismatched worker',
    },
    {
      binding: { ...validBinding, subjectKey: 'other:subject' },
      label: 'mismatched subject',
    },
    {
      binding: { ...validBinding, payload: { purpose: 'publish_content' } },
      label: 'invalid payload',
    },
  ])('fails closed for $label', ({ binding }) => {
    expect(() => resolveRegisteredTaskKindForSettlement(binding)).toThrowError(
      expect.objectContaining({ code: 'invalid_event' })
    )
  })
})
