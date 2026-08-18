import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { parseEveMessageProjectionEvent } from './eve-message-event'

const meta = {
  at: '2026-08-18T00:00:00.000Z',
  id: 'evt_01',
}

describe('persisted Eve message adapter', () => {
  it('returns a validated reducer event', () => {
    expect(
      parseEveMessageProjectionEvent({
        data: {
          finishReason: 'stop',
          message: 'Validated message',
          sequence: 0,
          stepIndex: 0,
          turnId: 'turn_01',
        },
        meta,
        type: 'message.completed',
      })
    ).toEqual({
      data: {
        finishReason: 'stop',
        message: 'Validated message',
        sequence: 0,
        stepIndex: 0,
        turnId: 'turn_01',
      },
      meta,
      type: 'message.completed',
    })
  })

  it('drops valid persisted events that the Eve message reducer ignores', () => {
    expect(
      parseEveMessageProjectionEvent({
        data: { wait: 'next-user-message' },
        meta,
        type: 'session.waiting',
      })
    ).toBeNull()
  })

  it('rejects malformed reducer events instead of casting JSONB', () => {
    expect(() =>
      parseEveMessageProjectionEvent({
        data: { message: 42, turnId: 'turn_01' },
        meta,
        type: 'message.completed',
      })
    ).toThrow()
  })
})
