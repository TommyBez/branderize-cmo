import { BrainError } from '@repo/brain/errors'
import type { SessionAuthContext } from 'eve/context'
import type { HookContext, HookEvent } from 'eve/hooks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bindCmoSession: vi.fn(() => Promise.resolve()),
  database: { kind: 'database-fixture' },
  ingestSessionEvent: vi.fn(() => Promise.resolve()),
  parsePersistableSessionEvent: vi.fn((event: unknown) => event),
  reportSessionEventIngestionFailure: vi.fn(),
  resolveTrustedCmoSessionMemberAccess: vi.fn(async () => ({
    brandId: '11111111-1111-4111-8111-111111111111',
    conversationId: '22222222-2222-4222-8222-222222222222',
    humanActorId: '33333333-3333-4333-8333-333333333333',
    humanActorKey: 'human:user-fixture',
    organizationId: 'organization-fixture',
    role: 'owner',
    userId: 'user-fixture',
  })),
}))

vi.mock('@repo/agents/runtime-alert', () => ({
  reportSessionEventIngestionFailure: mocks.reportSessionEventIngestionFailure,
}))

vi.mock('@repo/brain/conversations', () => ({
  bindCmoSession: mocks.bindCmoSession,
}))

vi.mock('@repo/brain/session-events', () => ({
  ingestSessionEvent: mocks.ingestSessionEvent,
  parsePersistableSessionEvent: mocks.parsePersistableSessionEvent,
}))

vi.mock('@repo/db', () => ({ db: mocks.database }))

vi.mock('./runtime-access', async (importOriginal) => {
  const original = await importOriginal<typeof import('./runtime-access')>()
  return {
    ...original,
    resolveTrustedCmoSessionMemberAccess:
      mocks.resolveTrustedCmoSessionMemberAccess,
  }
})

import { cmoAuditHook } from './cmo-audit'

const BRAND_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222'
const SESSION_ID = 'session-cmo-fixture'

const cmoAuth: SessionAuthContext = {
  attributes: {
    brand_id: BRAND_ID,
    conversation_id: CONVERSATION_ID,
  },
  authenticator: 'cmo-bridge',
  principalId: 'user-fixture',
  principalType: 'user',
  subject: 'user-fixture',
}

const createContext = ({
  current = cmoAuth,
}: {
  readonly current?: SessionAuthContext | null
} = {}): HookContext => ({
  agent: { name: 'CMO' },
  channel: { kind: 'test' },
  getSandbox: () =>
    Promise.reject(new Error('Sandbox is not used by the audit hook')),
  getSkill: () => {
    throw new Error('Skills are not used by the audit hook')
  },
  session: {
    auth: { current, initiator: cmoAuth },
    id: SESSION_ID,
    turn: { id: 'turn-cmo-fixture', sequence: 0 },
  },
})

const sessionStartedEvent = {
  data: {},
  meta: {
    at: '2026-08-18T00:00:00.000Z',
    id: 'event-cmo-session-started',
  },
  type: 'session.started',
} satisfies HookEvent<'session.started'>

const turnFailedEvent = {
  data: {
    code: 'provider_failure',
    message: 'raw event secret',
    sequence: 0,
    turnId: 'turn-cmo-fixture',
  },
  meta: {
    at: '2026-08-18T00:00:01.000Z',
    id: 'event-cmo-turn-failed',
  },
  type: 'turn.failed',
} satisfies HookEvent<'turn.failed'>

const auditHandler = () => {
  const handler = cmoAuditHook.events?.['*']
  if (handler === undefined) {
    throw new Error('Expected the CMO wildcard audit handler')
  }
  return handler
}

describe('CMO audit hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed before persistence when session identity is invalid', async () => {
    await expect(
      auditHandler()(sessionStartedEvent, createContext({ current: null }))
    ).rejects.toThrow('CMO current authentication is missing')

    expect(mocks.resolveTrustedCmoSessionMemberAccess).not.toHaveBeenCalled()
    expect(mocks.bindCmoSession).not.toHaveBeenCalled()
    expect(mocks.parsePersistableSessionEvent).not.toHaveBeenCalled()
    expect(mocks.reportSessionEventIngestionFailure).not.toHaveBeenCalled()
  })

  it('fails closed when root access resolution fails', async () => {
    mocks.resolveTrustedCmoSessionMemberAccess.mockRejectedValueOnce(
      new Error('access unavailable')
    )

    await expect(
      auditHandler()(sessionStartedEvent, createContext())
    ).rejects.toThrow('access unavailable')

    expect(mocks.bindCmoSession).not.toHaveBeenCalled()
    expect(mocks.parsePersistableSessionEvent).not.toHaveBeenCalled()
    expect(mocks.reportSessionEventIngestionFailure).not.toHaveBeenCalled()
  })

  it('fails closed when root binding fails', async () => {
    mocks.bindCmoSession.mockRejectedValueOnce(new Error('binding unavailable'))

    await expect(
      auditHandler()(sessionStartedEvent, createContext())
    ).rejects.toThrow('binding unavailable')

    expect(mocks.parsePersistableSessionEvent).not.toHaveBeenCalled()
    expect(mocks.reportSessionEventIngestionFailure).not.toHaveBeenCalled()
  })

  it('binds from the raw event type before absorbing envelope drift', async () => {
    mocks.parsePersistableSessionEvent.mockImplementationOnce(() => {
      throw new Error('raw event secret')
    })

    await expect(
      auditHandler()(sessionStartedEvent, createContext())
    ).resolves.toBeUndefined()

    expect(mocks.resolveTrustedCmoSessionMemberAccess).toHaveBeenCalledTimes(1)
    expect(mocks.bindCmoSession).toHaveBeenCalledTimes(1)
    expect(mocks.ingestSessionEvent).not.toHaveBeenCalled()
    expect(
      mocks.reportSessionEventIngestionFailure
    ).toHaveBeenCalledExactlyOnceWith('agent-cmo')
  })

  it('absorbs a persistence callback failure without exposing raw context', async () => {
    mocks.ingestSessionEvent.mockRejectedValueOnce(
      new Error('database contains a private payload')
    )

    await expect(
      auditHandler()(turnFailedEvent, createContext())
    ).resolves.toBeUndefined()

    expect(
      mocks.reportSessionEventIngestionFailure
    ).toHaveBeenCalledExactlyOnceWith('agent-cmo')
    const alertArguments = JSON.stringify(
      mocks.reportSessionEventIngestionFailure.mock.calls
    )
    expect(alertArguments).not.toContain('raw event secret')
    expect(alertArguments).not.toContain(BRAND_ID)
    expect(alertArguments).not.toContain(SESSION_ID)
  })

  it('keeps a rejected canonical audit transaction out of the Eve outcome', async () => {
    mocks.ingestSessionEvent.mockRejectedValueOnce(
      new BrainError('invalid_event', 'The root binding does not match')
    )

    await expect(
      auditHandler()(turnFailedEvent, createContext())
    ).resolves.toBeUndefined()

    expect(
      mocks.reportSessionEventIngestionFailure
    ).toHaveBeenCalledExactlyOnceWith('agent-cmo')
  })

  it('keeps reporter failure outside the Eve outcome', async () => {
    mocks.ingestSessionEvent.mockRejectedValueOnce(new Error('database down'))
    mocks.reportSessionEventIngestionFailure.mockImplementationOnce(() => {
      throw new Error('stderr down')
    })

    await expect(
      auditHandler()(turnFailedEvent, createContext())
    ).resolves.toBeUndefined()
  })
})
