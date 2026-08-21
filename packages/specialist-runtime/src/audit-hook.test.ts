import { BrainError } from '@repo/brain/errors'
import type { ClaimedTask, TaskGeneration } from '@repo/brain/tasks'
import type { SessionParent } from 'eve/context'
import type { HookContext, HookEvent } from 'eve/hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bindTaskSession: vi.fn(() => Promise.resolve()),
  database: { kind: 'database-fixture' },
  ingestSessionEvent: vi.fn(() => Promise.resolve()),
  parsePersistableSessionEvent: vi.fn((event: unknown) => event),
  reportSessionEventIngestionFailure: vi.fn(),
}))

vi.mock('@repo/agents/runtime-alert', () => ({
  reportSessionEventIngestionFailure: mocks.reportSessionEventIngestionFailure,
}))

vi.mock('@repo/brain/session-events', () => ({
  ingestSessionEvent: mocks.ingestSessionEvent,
  parsePersistableSessionEvent: mocks.parsePersistableSessionEvent,
}))

vi.mock('@repo/brain/tasks', () => ({
  bindTaskSession: mocks.bindTaskSession,
}))

vi.mock('@repo/db', () => ({ db: mocks.database }))

import { defineTaskAuditHook } from './audit-hook'
import { createTaskSessionAuth } from './session-envelope'

const claim: ClaimedTask = {
  agentActorId: '11111111-1111-4111-8111-111111111111',
  agentActorKey: 'agent:product-marketer',
  brandId: '33333333-3333-4333-8333-333333333333',
  claimContext: {
    brandContextContent: { summary: 'Current context' },
    brandContextObjectId: '22222222-2222-4222-8222-222222222222',
  },
  intentSnapshot: {
    acceptance_criteria: [{ metric: 'qualified demand' }],
    brand_id: '33333333-3333-4333-8333-333333333333',
    constraints: null,
    intent_id: '00000000-0000-0000-0000-000000000203',
    intent_revision: 1,
    preauthorizations: [],
    statement: 'Clarify the value proposition',
  },
  kind: 'product-marketer.brand-context.v1',
  payload: { purpose: 'enrich_brand_context' },
  startedAt: new Date('2026-08-18T00:00:00.000Z') as TaskGeneration,
  taskId: '44444444-4444-4444-8444-444444444444',
  workerKey: 'product-marketer',
}

const taskAuth = createTaskSessionAuth(claim)
const SESSION_ID = 'session-product-marketer-fixture'
const BRAND_ID = claim.brandId
const TASK_ID = claim.taskId

const childParent: SessionParent = {
  callId: 'call-product-marketer-child',
  rootSessionId: SESSION_ID,
  sessionId: SESSION_ID,
  turn: { id: 'turn-product-marketer-parent', sequence: 0 },
}

const createContext = ({
  current = taskAuth,
  parent,
}: {
  readonly current?: typeof taskAuth | null
  readonly parent?: SessionParent
} = {}): HookContext => ({
  agent: { name: 'Product Marketer' },
  channel: { kind: 'test' },
  getSandbox: () =>
    Promise.reject(new Error('Sandbox is not used by the audit hook')),
  getSkill: () => {
    throw new Error('Skills are not used by the audit hook')
  },
  session: {
    auth: { current, initiator: taskAuth },
    id: parent === undefined ? SESSION_ID : 'session-product-marketer-child',
    ...(parent === undefined ? {} : { parent }),
    turn: { id: 'turn-product-marketer-fixture', sequence: 0 },
  },
})

const sessionStartedEvent = {
  data: {},
  meta: {
    at: '2026-08-18T00:00:00.000Z',
    id: 'event-product-marketer-session-started',
  },
  type: 'session.started',
} satisfies HookEvent<'session.started'>

const sessionCompletedEvent = {
  meta: {
    at: '2026-08-18T00:00:01.000Z',
    id: 'event-product-marketer-session-completed',
  },
  type: 'session.completed',
} satisfies HookEvent<'session.completed'>

const auditHandler = () => {
  const handler = defineTaskAuditHook().events?.['*']
  if (handler === undefined) {
    throw new Error('Expected the specialist wildcard audit handler')
  }
  return handler
}

describe('specialist task audit hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed before persistence when session identity is invalid', async () => {
    await expect(
      auditHandler()(sessionStartedEvent, createContext({ current: null }))
    ).rejects.toThrow('Task session authentication is missing')

    expect(mocks.bindTaskSession).not.toHaveBeenCalled()
    expect(mocks.parsePersistableSessionEvent).not.toHaveBeenCalled()
    expect(mocks.reportSessionEventIngestionFailure).not.toHaveBeenCalled()
  })

  it('fails closed when session auth carries no task attributes', async () => {
    await expect(
      auditHandler()(
        sessionStartedEvent,
        createContext({
          current: {
            attributes: {},
            authenticator: 'eve-dev',
            principalId: 'anonymous',
            principalType: 'user',
          },
        })
      )
    ).rejects.toThrow('Trusted task attribute agent_actor_id is missing')

    expect(mocks.bindTaskSession).not.toHaveBeenCalled()
    expect(mocks.parsePersistableSessionEvent).not.toHaveBeenCalled()
    expect(mocks.reportSessionEventIngestionFailure).not.toHaveBeenCalled()
  })

  it('fails closed when root binding fails', async () => {
    mocks.bindTaskSession.mockRejectedValueOnce(
      new Error('binding unavailable')
    )

    await expect(
      auditHandler()(sessionStartedEvent, createContext())
    ).rejects.toThrow('binding unavailable')

    expect(mocks.parsePersistableSessionEvent).not.toHaveBeenCalled()
    expect(mocks.reportSessionEventIngestionFailure).not.toHaveBeenCalled()
  })

  it('binds from the raw event type before absorbing envelope drift', async () => {
    mocks.parsePersistableSessionEvent.mockImplementationOnce(() => {
      throw new Error('raw task event secret')
    })

    await expect(
      auditHandler()(sessionStartedEvent, createContext())
    ).resolves.toBeUndefined()

    expect(mocks.bindTaskSession).toHaveBeenCalledTimes(1)
    expect(mocks.ingestSessionEvent).not.toHaveBeenCalled()
    expect(
      mocks.reportSessionEventIngestionFailure
    ).toHaveBeenCalledExactlyOnceWith('agent-product-marketer')
  })

  it('absorbs a persistence callback failure without exposing raw context', async () => {
    mocks.ingestSessionEvent.mockRejectedValueOnce(
      new Error('database contains a private task payload')
    )

    await expect(
      auditHandler()(sessionCompletedEvent, createContext())
    ).resolves.toBeUndefined()

    expect(
      mocks.reportSessionEventIngestionFailure
    ).toHaveBeenCalledExactlyOnceWith('agent-product-marketer')
    const alertArguments = JSON.stringify(
      mocks.reportSessionEventIngestionFailure.mock.calls
    )
    expect(alertArguments).not.toContain(BRAND_ID)
    expect(alertArguments).not.toContain(TASK_ID)
    expect(alertArguments).not.toContain(SESSION_ID)
  })

  it('keeps a rejected canonical audit transaction out of the Eve outcome', async () => {
    mocks.ingestSessionEvent.mockRejectedValueOnce(
      new BrainError('invalid_event', 'The task root binding does not match')
    )

    await expect(
      auditHandler()(sessionCompletedEvent, createContext())
    ).resolves.toBeUndefined()

    expect(
      mocks.reportSessionEventIngestionFailure
    ).toHaveBeenCalledExactlyOnceWith('agent-product-marketer')
  })

  it('keeps reporter failure outside the Eve outcome', async () => {
    mocks.ingestSessionEvent.mockRejectedValueOnce(new Error('database down'))
    mocks.reportSessionEventIngestionFailure.mockImplementationOnce(() => {
      throw new Error('stderr down')
    })

    await expect(
      auditHandler()(sessionCompletedEvent, createContext())
    ).resolves.toBeUndefined()
  })

  it('does not bind a child session even for its session.started event', async () => {
    await expect(
      auditHandler()(
        sessionStartedEvent,
        createContext({ parent: childParent })
      )
    ).resolves.toBeUndefined()

    expect(mocks.bindTaskSession).not.toHaveBeenCalled()
    expect(mocks.parsePersistableSessionEvent).toHaveBeenCalledTimes(1)
    expect(mocks.ingestSessionEvent).toHaveBeenCalledTimes(1)
  })
})
