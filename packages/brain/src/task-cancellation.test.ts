import { describe, expect, it } from 'vitest'

import {
  cancelTaskInputSchema,
  cancelTaskReceiptSchema,
} from './task-cancellation'

const taskId = '018f47a6-72d3-7a93-b49a-d91f50dd1882'
const actionId = '018f47a6-72d3-7a93-b49a-d91f50dd1993'

describe('commitment cancellation command inputs', () => {
  it('accepts a task identity without a revision or payload hash', () => {
    expect(
      cancelTaskInputSchema.parse({
        requestId: 'cancel-1',
        taskId,
      })
    ).toEqual({
      requestId: 'cancel-1',
      taskId,
    })
  })

  it('rejects expectedRevision, rationale, and payloadHash on the command', () => {
    expect(() =>
      cancelTaskInputSchema.parse({
        expectedRevision: 1,
        requestId: 'cancel-2',
        taskId,
      })
    ).toThrow()
    expect(() =>
      cancelTaskInputSchema.parse({
        payloadHash: 'a'.repeat(64),
        requestId: 'cancel-3',
        taskId,
      })
    ).toThrow()
    expect(() =>
      cancelTaskInputSchema.parse({
        rationale: 'Stop this draft.',
        requestId: 'cancel-4',
        taskId,
      })
    ).toThrow()
  })

  it('keeps a lost cancel as a typed return without an Action id', () => {
    expect(
      cancelTaskReceiptSchema.parse({
        actionId,
        finishedAt: '2026-08-20T10:00:00.000Z',
        kind: 'content.notion-page.v1',
        outcome: 'cancelled',
        taskId,
      })
    ).toMatchObject({
      outcome: 'cancelled',
      taskId,
    })
    expect(
      cancelTaskReceiptSchema.parse({
        outcome: 'already_claimed',
        taskId,
      })
    ).toEqual({
      outcome: 'already_claimed',
      taskId,
    })
    expect(() =>
      cancelTaskReceiptSchema.parse({
        actionId,
        outcome: 'already_claimed',
        taskId,
      })
    ).toThrow()
    expect(() =>
      cancelTaskReceiptSchema.parse({
        accessToken: 'should-not-be-accepted',
        actionId,
        finishedAt: '2026-08-20T10:00:00.000Z',
        kind: 'content.notion-page.v1',
        outcome: 'cancelled',
        taskId,
      })
    ).toThrow()
  })
})
