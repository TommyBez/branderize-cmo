import { BrainError } from '@repo/brain/errors'
import type { SessionAuthContext, SessionParent } from 'eve/context'
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

import productMarketerAuditHook from '../hooks/audit'

const AGENT_ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const BRAND_CONTEXT_OBJECT_ID = '22222222-2222-4222-8222-222222222222'
const BRAND_ID = '33333333-3333-4333-8333-333333333333'
const TASK_ID = '44444444-4444-4444-8444-444444444444'
const SESSION_ID = 'session-product-marketer-fixture'

const taskAuth: SessionAuthContext = {
  attributes: {
    agent_actor_id: AGENT_ACTOR_ID,
    agent_actor_key: 'agent:product-marketer',
    brand_context_object_id: BRAND_CONTEXT_OBJECT_ID,
    brand_id: BRAND_ID,
    task_id: TASK_ID,
    task_started_at: '2026-08-18T00:00:00.000Z',
    worker_key: 'product-marketer',
  },
  authenticator: 'product-marketer-dispatch',
  issuer: 'branderize-agent-server',
  principalId: AGENT_ACTOR_ID,
  principalType: 'agent',
  subject: 'agent:product-marketer',
}

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
  readonly current?: SessionAuthContext | null
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
  const handler = productMarketerAuditHook.events?.['*']
  if (handler === undefined) {
    throw new Error('Expected the Product Marketer wildcard audit handler')
  }
  return handler
}

describe('Product Marketer audit hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed before persistence when session identity is invalid', async () => {
    await expect(
      auditHandler()(sessionStartedEvent, createContext({ current: null }))
    ).rejects.toThrow('Product Marketer session authentication is missing')

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
