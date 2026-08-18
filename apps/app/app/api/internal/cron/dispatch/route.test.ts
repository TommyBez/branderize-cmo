import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handledErrorMock, operationalLogMock } = vi.hoisted(() => ({
  handledErrorMock: vi.fn(),
  operationalLogMock: vi.fn(),
}))

vi.mock('@/lib/agent-endpoints', () => ({
  resolveFleetEndpoints: () =>
    [
      'cmo',
      'content',
      'distribution',
      'growth',
      'lifecycle',
      'product-marketer',
      'seo-discovery',
    ].map((agentKey) => ({
      agentKey,
      endpoint: `https://${agentKey}.example.test`,
    })),
}))

vi.mock('@/lib/auth', () => ({
  appEnvironment: {
    CRON_SECRET: 'test-cron-secret-at-least-thirty-two-bytes',
    DISPATCH_SECRET: 'test-dispatch-secret-at-least-thirty-two-bytes',
  },
}))

vi.mock('@/lib/observability', () => ({
  elapsedTelemetryMilliseconds: () => 12,
  scheduleAppHandledError: handledErrorMock,
  scheduleAppOperationalLog: operationalLogMock,
}))

import { GET } from './route'

const CRON_SECRET = 'test-cron-secret-at-least-thirty-two-bytes'
const fetchMock = vi.fn<typeof globalThis.fetch>()

const dispatchRequest = (search = ''): Request =>
  new Request(`https://app.example.test/api/internal/cron/dispatch${search}`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })

describe('GET /api/internal/cron/dispatch', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    operationalLogMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns success only when every root acknowledges with exactly 202', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))

    const response = await GET(dispatchRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accepted: 7,
      attempted: 7,
      status: 'ok',
    })
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(operationalLogMock).toHaveBeenCalledTimes(8)
    for (const agentKey of [
      'cmo',
      'content',
      'distribution',
      'growth',
      'lifecycle',
      'product-marketer',
      'seo-discovery',
    ]) {
      expect(operationalLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ agentKey, outcome: 'completed' })
      )
    }
    expect(operationalLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'completed' })
    )
  })

  it.each([200, 204, 206])(
    'treats a %s response as a failed acknowledgement',
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValue(new Response(null, { status: 202 }))

      const response = await GET(dispatchRequest())

      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toEqual({
        accepted: 6,
        attempted: 7,
        status: 'partial',
      })
      expect(operationalLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ agentKey: 'cmo', outcome: 'failed' })
      )
      expect(operationalLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'partial' })
      )
    }
  )

  it('rejects selectors before contacting any root', async () => {
    const response = await GET(dispatchRequest('?task=forbidden'))

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
