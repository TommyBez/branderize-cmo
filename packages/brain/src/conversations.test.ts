import { describe, expect, it } from 'vitest'

import {
  authorizeCmoOperationForRole,
  bindCmoSessionInputSchema,
  cmoSessionOperationSchema,
  createCmoConversationInputSchema,
  listCmoConversationsInputSchema,
} from './conversations'
import type { BrainError } from './errors'

describe('CMO conversation contracts', () => {
  it('keeps every read class available to an exact owner-viewer', () => {
    for (const name of [
      'metadata',
      'reconnect',
      'snapshot',
      'stream',
      'transcript',
    ] as const) {
      expect(
        authorizeCmoOperationForRole({
          operation: { kind: 'read', name },
          role: 'viewer',
        })
      ).toEqual({ kind: 'read', name })
    }
  })

  it('denies every model-writing operation to a viewer', () => {
    for (const name of [
      'clear',
      'compact',
      'input-responses',
      'message',
      'reset',
    ] as const) {
      expect(() =>
        authorizeCmoOperationForRole({
          operation: { kind: 'write', name },
          role: 'viewer',
        })
      ).toThrow(
        expect.objectContaining<Partial<BrainError>>({ code: 'access_denied' })
      )
    }
  })

  it('scopes a viewer cancel to the exact non-empty turn target', () => {
    expect(
      authorizeCmoOperationForRole({
        operation: { kind: 'cancel', turnId: 'turn-7' },
        role: 'viewer',
      })
    ).toEqual({
      kind: 'cancel',
      scope: 'exact-observed-turn',
      turnId: 'turn-7',
    })
    expect(
      cmoSessionOperationSchema.safeParse({ kind: 'cancel', turnId: '' })
        .success
    ).toBe(false)
  })

  it('allows current writer roles to send and cancel', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(
        authorizeCmoOperationForRole({
          operation: { kind: 'write', name: 'message' },
          role,
        })
      ).toEqual({ kind: 'write', name: 'message' })
      expect(
        authorizeCmoOperationForRole({
          operation: { kind: 'cancel', turnId: 'turn-current' },
          role,
        })
      ).toEqual({
        kind: 'cancel',
        scope: 'writer',
        turnId: 'turn-current',
      })
    }
  })

  it('accepts only an explicit top-level hook or proxy response binding', () => {
    expect(
      bindCmoSessionInputSchema.safeParse({
        conversationId: 'd2429e8c-7d06-4507-8c3f-f7f51255d3b0',
        parentSessionId: null,
        sessionId: 'session-root',
        source: 'root-hook',
      }).success
    ).toBe(true)
    expect(
      bindCmoSessionInputSchema.safeParse({
        conversationId: 'd2429e8c-7d06-4507-8c3f-f7f51255d3b0',
        parentSessionId: 'session-parent',
        sessionId: 'session-child',
        source: 'root-hook',
      }).success
    ).toBe(false)
    expect(
      bindCmoSessionInputSchema.safeParse({
        conversationId: 'd2429e8c-7d06-4507-8c3f-f7f51255d3b0',
        parentSessionId: null,
        sessionId: 'session-root',
        source: 'proxy-create-response',
      }).success
    ).toBe(false)
  })

  it('rejects unknown session route classes and extra input', () => {
    expect(
      cmoSessionOperationSchema.safeParse({
        kind: 'read',
        name: 'future-route',
      }).success
    ).toBe(false)
    expect(
      createCmoConversationInputSchema.safeParse({
        ownerUserId: 'attacker-selected-owner',
        title: 'Planning',
      }).success
    ).toBe(false)
    expect(listCmoConversationsInputSchema.parse({})).toEqual({
      cursor: null,
      includeArchived: false,
      limit: 25,
    })
  })
})
