import { describe, expect, it } from 'vitest'

import {
  abandonIntentInputSchema,
  adoptIntentInputSchema,
  declareIntentInputSchema,
  refineIntentInputSchema,
} from './intents'

const intentId = '018f47a6-72d3-7a93-b49a-d91f50dd1771'

describe('Intent command inputs', () => {
  it('accepts a root declaration with optional typed structure', () => {
    expect(
      declareIntentInputSchema.parse({
        acceptanceCriteria: [{ metric: 'qualified conversations' }],
        constraints: [{ kind: 'budget', value: 'alpha-only' }],
        requestId: 'request-1',
        statement: 'Clarify the market position.',
      })
    ).toMatchObject({
      acceptanceCriteria: [{ metric: 'qualified conversations' }],
      constraints: [{ kind: 'budget', value: 'alpha-only' }],
    })
  })

  it('prevents constraints from skipping acceptance criteria', () => {
    expect(() =>
      refineIntentInputSchema.parse({
        acceptanceCriteria: null,
        constraints: [{ kind: 'deadline', value: 'Q4' }],
        expectedRevision: 1,
        intentId,
        requestId: 'request-2',
      })
    ).toThrow('Constraints require acceptance criteria')
  })

  it('does not let refinement silently edit the Intent statement', () => {
    expect(() =>
      refineIntentInputSchema.parse({
        acceptanceCriteria: [{ metric: 'qualified conversations' }],
        constraints: null,
        expectedRevision: 1,
        intentId,
        requestId: 'request-3',
        statement: 'Replace the objective.',
      })
    ).toThrow()
  })

  it('keeps adopt and abandon on exact revision identity', () => {
    expect(
      adoptIntentInputSchema.parse({
        expectedRevision: 1,
        intentId,
        requestId: 'adopt-1',
      })
    ).toEqual({
      expectedRevision: 1,
      intentId,
      requestId: 'adopt-1',
    })
    expect(
      abandonIntentInputSchema.parse({
        expectedRevision: 2,
        intentId,
        rationale: 'The objective is no longer current.',
        requestId: 'abandon-1',
      })
    ).toEqual({
      expectedRevision: 2,
      intentId,
      rationale: 'The objective is no longer current.',
      requestId: 'abandon-1',
    })
  })

  it('does not let adopt or abandon carry statement edits', () => {
    expect(() =>
      adoptIntentInputSchema.parse({
        expectedRevision: 1,
        intentId,
        requestId: 'adopt-2',
        statement: 'Replace the objective.',
      })
    ).toThrow()
    expect(() =>
      abandonIntentInputSchema.parse({
        expectedRevision: 1,
        intentId,
        requestId: 'abandon-2',
        status: 'abandoned',
      })
    ).toThrow()
  })

  it('rejects a blank abandon rationale', () => {
    expect(() =>
      abandonIntentInputSchema.parse({
        expectedRevision: 1,
        intentId,
        rationale: '   ',
        requestId: 'abandon-3',
      })
    ).toThrow()
  })
})
