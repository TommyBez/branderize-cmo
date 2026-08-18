import { describe, expect, it, vi } from 'vitest'

import {
  createDispatchAckHandler,
  createPayloadFreeDispatchHandler,
} from './dispatch-handler'

const DISPATCH_SECRET = 'dispatch-secret-at-least-32-characters'

const request = ({
  authorization = `Bearer ${DISPATCH_SECRET}`,
  body,
  query = '',
}: {
  readonly authorization?: string | null
  readonly body?: string
  readonly query?: string
} = {}): Request => {
  const headers = new Headers()
  if (authorization !== null) {
    headers.set('authorization', authorization)
  }
  return new Request(`https://agent.example/internal/dispatch${query}`, {
    body,
    headers,
    method: 'POST',
  })
}

describe('payload-free dispatch handler', () => {
  it.each([
    { readSecret: () => undefined, status: 503 },
    { readSecret: () => 'too-short', status: 503 },
    { authorization: null, status: 401 },
    { authorization: 'Basic credentials', status: 401 },
    { authorization: 'Bearer wrong-secret', status: 401 },
    { authorization: `Bearer  ${DISPATCH_SECRET}`, status: 401 },
    { query: '?task=forbidden', status: 400 },
    { body: '{}', status: 400 },
  ])('rejects an invalid request with $status', async (fixture) => {
    const handle = createDispatchAckHandler({
      readSecret: fixture.readSecret ?? (() => DISPATCH_SECRET),
    })
    const response = await handle(
      request({
        authorization: fixture.authorization,
        body: fixture.body,
        query: fixture.query,
      })
    )

    expect(response.status).toBe(fixture.status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    if (fixture.status === 401) {
      expect(response.headers.get('www-authenticate')).toBe('Bearer')
    }
  })

  it('acknowledges an authenticated request without selectors or a body', async () => {
    const response = await createDispatchAckHandler({
      readSecret: () => DISPATCH_SECRET,
    })(request())

    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.text()).resolves.toBe('')
  })

  it('runs accepted work only after request validation', async () => {
    const onAccepted = vi.fn<(context: { readonly root: string }) => void>()
    const handle = createPayloadFreeDispatchHandler({
      onAccepted,
      readSecret: () => DISPATCH_SECRET,
    })

    await expect(
      handle(request({ body: '{}' }), { root: 'product-marketer' })
    ).resolves.toMatchObject({ status: 400 })
    expect(onAccepted).not.toHaveBeenCalled()

    await expect(
      handle(request(), { root: 'product-marketer' })
    ).resolves.toMatchObject({ status: 202 })
    expect(onAccepted).toHaveBeenCalledExactlyOnceWith({
      root: 'product-marketer',
    })
  })
})
