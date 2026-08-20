import { describe, expect, it } from 'vitest'

import {
  dismissTaskInputSchema,
  dismissTaskReceiptSchema,
  reopenTaskInputSchema,
  reopenTaskReceiptSchema,
} from './task-dismissal'
import { dismissedCommitmentDispositionSchema } from './task-prepare-commitment'

const taskId = '018f47a6-72d3-7a93-b49a-d91f50dd1882'
const brandId = '018f47a6-72d3-7a93-b49a-d91f50dd1771'
const actionId = '018f47a6-72d3-7a93-b49a-d91f50dd1993'
const payloadHash = 'a'.repeat(64)

describe('commitment dismissal command inputs', () => {
  it('accepts dismiss with optional rationale and reopen without a revision', () => {
    expect(
      dismissTaskInputSchema.parse({
        rationale: 'The draft is no longer needed.',
        requestId: 'dismiss-1',
        taskId,
      })
    ).toEqual({
      rationale: 'The draft is no longer needed.',
      requestId: 'dismiss-1',
      taskId,
    })
    expect(
      dismissTaskInputSchema.parse({
        requestId: 'dismiss-2',
        taskId,
      })
    ).toEqual({
      requestId: 'dismiss-2',
      taskId,
    })
    expect(
      reopenTaskInputSchema.parse({
        requestId: 'reopen-1',
        taskId,
      })
    ).toEqual({
      requestId: 'reopen-1',
      taskId,
    })
  })

  it('rejects expectedRevision, payload edits, and blank rationale', () => {
    expect(() =>
      dismissTaskInputSchema.parse({
        expectedRevision: 1,
        requestId: 'dismiss-3',
        taskId,
      })
    ).toThrow()
    expect(() =>
      reopenTaskInputSchema.parse({
        expectedRevision: 1,
        requestId: 'reopen-2',
        taskId,
      })
    ).toThrow()
    expect(() =>
      dismissTaskInputSchema.parse({
        rationale: '   ',
        requestId: 'dismiss-4',
        taskId,
      })
    ).toThrow()
    expect(() =>
      reopenTaskInputSchema.parse({
        payload: { title: 'Edited' },
        requestId: 'reopen-3',
        taskId,
      })
    ).toThrow()
  })

  it('freezes the dismissal tuple on the receipt and keeps reopen on the same hash', () => {
    expect(
      dismissTaskReceiptSchema.parse({
        actionId,
        brandId,
        finishedAt: '2026-08-20T10:00:00.000Z',
        kind: 'content.notion-page.v1',
        outcome: 'commitment_dismissed',
        payloadHash,
        taskId,
      })
    ).toMatchObject({
      brandId,
      kind: 'content.notion-page.v1',
      outcome: 'commitment_dismissed',
      payloadHash,
      taskId,
    })
    expect(
      reopenTaskReceiptSchema.parse({
        actionId,
        brandId,
        kind: 'content.notion-page.v1',
        outcome: 'commitment_reopened',
        payloadHash,
        taskId,
      })
    ).toMatchObject({
      brandId,
      outcome: 'commitment_reopened',
      payloadHash,
      taskId,
    })
    expect(
      dismissedCommitmentDispositionSchema.parse({
        disposition: 'dismissed',
      })
    ).toEqual({ disposition: 'dismissed' })
  })

  it('does not let a token-like field into dismissal or reopen receipts', () => {
    expect(() =>
      dismissTaskReceiptSchema.parse({
        accessToken: 'should-not-be-accepted',
        actionId,
        brandId,
        finishedAt: '2026-08-20T10:00:00.000Z',
        kind: 'content.notion-page.v1',
        outcome: 'commitment_dismissed',
        payloadHash,
        taskId,
      })
    ).toThrow()
    expect(() =>
      reopenTaskReceiptSchema.parse({
        actionId,
        brandId,
        kind: 'content.notion-page.v1',
        outcome: 'commitment_reopened',
        payloadHash,
        providerToken: 'should-not-be-accepted',
        taskId,
      })
    ).toThrow()
  })
})
