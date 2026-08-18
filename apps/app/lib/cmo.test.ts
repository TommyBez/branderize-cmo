import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BEARER_TOKEN_PATTERN = /^Bearer [^.]+\.[^.]+\.[^.]+$/u

const { fetchMock, resolveAgentEndpointMock } = vi.hoisted(() => ({
  fetchMock: vi.fn<typeof fetch>(),
  resolveAgentEndpointMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@repo/brain/conversations', () => ({
  openCmoConversation: vi.fn(),
  readPersistedCmoEvents: vi.fn(),
}))
vi.mock('@repo/brain/session-events', () => ({
  sessionEventEnvelopeSchema: { parse: vi.fn() },
}))
vi.mock('@repo/db', () => ({ db: {} }))
vi.mock('./agent-endpoints', () => ({
  resolveAgentEndpoint: resolveAgentEndpointMock,
}))
vi.mock('./auth', () => ({
  appEnvironment: {
    CMO_BRIDGE_SECRET:
      'cmo-server-unit-secret-that-is-long-enough-for-the-contract',
  },
}))
vi.mock('./dal', () => ({
  AppAccessError: class AppAccessError extends Error {},
  getProductMarketerTask: vi.fn(),
}))

import { fetchCmoRuntime } from './cmo'

describe('CMO runtime fetch boundary', () => {
  beforeEach(() => {
    resolveAgentEndpointMock.mockReturnValue('https://agent-cmo.example.test')
    fetchMock.mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves stream selectors as URL search parameters', async () => {
    const { signal } = new AbortController()
    const response = await fetchCmoRuntime({
      brandId: '00000000-0000-0000-0000-000000000001',
      conversationId: '00000000-0000-0000-0000-000000000002',
      init: { cache: 'no-store', method: 'GET', signal },
      path: '/eve/v1/session/session-1/stream?includeTailIndex=1',
      userId: 'user:owner',
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(
      'https://agent-cmo.example.test/eve/v1/session/session-1/stream?includeTailIndex=1'
    )
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBe(signal)
    expect(new Headers(init?.headers).get('authorization')).toMatch(
      BEARER_TOKEN_PATTERN
    )
  })

  it('preserves a configured endpoint base path', async () => {
    resolveAgentEndpointMock.mockReturnValue(
      'https://agent-cmo.example.test/root-0'
    )

    await fetchCmoRuntime({
      brandId: '00000000-0000-0000-0000-000000000001',
      conversationId: '00000000-0000-0000-0000-000000000002',
      init: { cache: 'no-store', method: 'GET' },
      path: '/eve/v1/session/session-1/stream?includeTailIndex=1',
      userId: 'user:owner',
    })

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(
      'https://agent-cmo.example.test/root-0/eve/v1/session/session-1/stream?includeTailIndex=1'
    )
  })
})
