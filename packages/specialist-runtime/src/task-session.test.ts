import type { ClaimedTask } from '@repo/brain/tasks'
import { taskGenerationOf } from '@repo/brain/tasks'
import { describe, expect, it } from 'vitest'

import { createTaskSessionAuth, taskAddressOf } from './session-envelope'
import {
  readTaskSession,
  requireRootTaskSession,
  stableTaskRequestId,
  taskExecutionOf,
  taskSessionLineageFromContext,
} from './task-session'

const STABLE_CONTEXT_REQUEST_PATTERN = /^eve:save-brand-context:[0-9a-f]{64}$/u

const claim: ClaimedTask = {
  agentActorId: '00000000-0000-0000-0000-000000000102',
  agentActorKey: 'agent:product-marketer',
  brandId: '00000000-0000-0000-0000-000000000201',
  claimContext: {
    brandContextContent: { summary: 'Current context' },
    brandContextObjectId: '00000000-0000-0000-0000-000000000202',
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
  startedAt: taskGenerationOf(new Date('2026-08-17T10:00:00.000Z')),
  taskId: '00000000-0000-4000-8000-000000000204',
  workerKey: 'product-marketer',
}

const trustedTaskContext = (taskClaim: ClaimedTask = claim) => {
  const auth = createTaskSessionAuth(taskClaim)
  return {
    session: {
      auth: { current: auth, initiator: auth },
      id: 'session-product-marketer',
      turn: { id: 'turn-product-marketer', sequence: 0 },
    },
  }
}

describe('task session envelope', () => {
  it('derives task authority from session auth and keeps request identity stable', () => {
    const context = trustedTaskContext()
    expect(readTaskSession(context)).toMatchObject({
      agentActorId: claim.agentActorId,
      brandId: claim.brandId,
      claimContext: {
        brandContextObjectId: claim.claimContext.brandContextObjectId,
      },
      startedAt: claim.startedAt,
      taskId: claim.taskId,
    })
    const first = stableTaskRequestId({
      context,
      operation: 'save-brand-context',
      semantics: { summary: 'Refined context' },
    })
    const second = stableTaskRequestId({
      context,
      operation: 'save-brand-context',
      semantics: { summary: 'Refined context' },
    })
    expect(first).toBe(second)
    expect(first).toMatch(STABLE_CONTEXT_REQUEST_PATTERN)

    const reclaimedContext = trustedTaskContext({
      ...claim,
      startedAt: taskGenerationOf(new Date(claim.startedAt.getTime() + 1)),
    })
    expect(
      stableTaskRequestId({
        context: reclaimedContext,
        operation: 'save-brand-context',
        semantics: { summary: 'Refined context' },
      })
    ).not.toBe(first)
  })

  it('preserves trusted task authority and exact lineage in a self-copy', () => {
    const rootContext = trustedTaskContext()
    const childContext = {
      session: {
        ...rootContext.session,
        id: 'session-product-marketer-child',
        parent: {
          callId: 'call-product-marketer-child',
          rootSessionId: rootContext.session.id,
          sessionId: rootContext.session.id,
          turn: rootContext.session.turn,
        },
      },
    }

    expect(readTaskSession(childContext)).toMatchObject({
      brandId: claim.brandId,
      rootSessionId: rootContext.session.id,
      sessionId: childContext.session.id,
      taskId: claim.taskId,
    })
    expect(taskExecutionOf(childContext)).toMatchObject({
      rootSessionId: rootContext.session.id,
      sessionId: childContext.session.id,
      taskId: claim.taskId,
    })
    expect(taskSessionLineageFromContext(childContext)).toEqual({
      kind: 'child',
      parentCallId: 'call-product-marketer-child',
      parentSessionId: rootContext.session.id,
      rootSessionId: rootContext.session.id,
      sessionId: childContext.session.id,
    })
    expect(() => requireRootTaskSession(rootContext)).not.toThrow()
    expect(() => requireRootTaskSession(childContext)).toThrow(
      'FINISH_TASK_ROOT_ONLY'
    )
  })

  it('requires matching scalar auth throughout the self-copy tree', () => {
    const trustedContext = trustedTaskContext()
    expect(() =>
      readTaskSession({
        session: {
          ...trustedContext.session,
          auth: {
            current: null,
            initiator: trustedContext.session.auth.initiator,
          },
        },
      })
    ).toThrow('session authentication is missing')
    expect(() =>
      readTaskSession({
        session: {
          ...trustedContext.session,
          auth: {
            current: {
              ...trustedContext.session.auth.current,
              attributes: {
                ...trustedContext.session.auth.current.attributes,
                brand_id: '00000000-0000-0000-0000-000000000999',
              },
            },
            initiator: trustedContext.session.auth.initiator,
          },
        },
      })
    ).toThrow('session authority changed')
  })

  it('uses one continuation address per persisted claim generation', () => {
    expect(
      taskAddressOf({
        startedAt: taskGenerationOf(new Date(claim.startedAt)),
        taskId: claim.taskId,
      })
    ).toBe(taskAddressOf(claim))
    expect(
      taskAddressOf({
        startedAt: taskGenerationOf(new Date(claim.startedAt.getTime() + 1)),
        taskId: claim.taskId,
      })
    ).not.toBe(taskAddressOf(claim))
  })

  it('keeps the live Product Marketer authenticator', () => {
    expect(createTaskSessionAuth(claim).authenticator).toBe(
      'product-marketer-dispatch'
    )
  })
})
