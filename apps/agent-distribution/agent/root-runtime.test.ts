import { describe, expect, it } from 'vitest'

import rootAgent from './agent'
import { createDispatchHandler } from './channels/dispatch'
import { ROOT_RUNTIME_CONTRACT } from './lib/root-contract'

const DISPATCH_SECRET = 'dispatch-secret-at-least-32-characters'
const handle = createDispatchHandler({ readSecret: () => DISPATCH_SECRET })

const request = ({
  body,
  query = '',
  secret = DISPATCH_SECRET,
}: {
  readonly body?: string
  readonly query?: string
  readonly secret?: string | null
} = {}): Request => {
  const headers = new Headers()
  if (secret !== null) {
    headers.set('authorization', `Bearer ${secret}`)
  }
  return new Request(`https://agent.example/internal/dispatch${query}`, {
    body,
    headers,
    method: 'POST',
  })
}

describe('Distribution root runtime', () => {
  it('is health-only with no task capability', () => {
    expect(ROOT_RUNTIME_CONTRACT).toMatchObject({
      agentKey: 'distribution',
      functional: false,
      health: { method: 'GET', path: '/eve/v1/health', public: true },
    })
    expect(ROOT_RUNTIME_CONTRACT.dispatch.supportedTaskKinds).toEqual([])
  })

  it('uses high reasoning without a custom compaction threshold', () => {
    expect(rootAgent.reasoning).toBe('high')
    expect(rootAgent).not.toHaveProperty('compaction')
  })

  it('rejects unauthenticated, selector-bearing, and body-bearing pokes', async () => {
    await expect(handle(request({ secret: null }))).resolves.toMatchObject({
      status: 401,
    })
    await expect(
      handle(request({ query: '?task=other' }))
    ).resolves.toMatchObject({ status: 400 })
    await expect(handle(request({ body: '{}' }))).resolves.toMatchObject({
      status: 400,
    })
  })

  it('only acknowledges an authenticated payload-free poke', async () => {
    const response = await handle(request())
    expect(response.status).toBe(202)
    await expect(response.text()).resolves.toBe('')
  })
})
