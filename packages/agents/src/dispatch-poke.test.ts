import { describe, expect, it } from 'vitest'

import {
  DISPATCH_POKE_TIMEOUT_MS,
  type DispatchFetch,
  postAgentDispatchPoke,
} from './dispatch-poke'

const configuration = {
  endpoint: 'https://product-marketer.example.test',
  secret: 'dispatch-secret-with-more-than-32-characters',
}

describe('agent dispatch poke', () => {
  it('posts one payload-free request and accepts only 202', async () => {
    let observedRequest:
      | { readonly init: RequestInit; readonly url: string }
      | undefined
    const fetch: DispatchFetch = (url, init) => {
      observedRequest = { init, url }
      return Promise.resolve(new Response(null, { status: 202 }))
    }

    await expect(
      postAgentDispatchPoke(configuration, { fetch })
    ).resolves.toEqual({ outcome: 'accepted' })
    expect(observedRequest).toBeDefined()
    expect(observedRequest?.url).toBe(
      'https://product-marketer.example.test/internal/dispatch'
    )
    expect(observedRequest?.init).toMatchObject({
      cache: 'no-store',
      headers: {
        authorization: 'Bearer dispatch-secret-with-more-than-32-characters',
      },
      method: 'POST',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    })
    expect(observedRequest?.init).not.toHaveProperty('body')
    expect(DISPATCH_POKE_TIMEOUT_MS).toBe(2000)
  })

  it('defers recovery for a non-202 response', async () => {
    const fetch: DispatchFetch = async () => new Response(null, { status: 204 })

    await expect(
      postAgentDispatchPoke(configuration, { fetch })
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: 'unexpected_status',
    })
  })

  it('defers recovery without exposing a transport error', async () => {
    const fetch: DispatchFetch = () =>
      Promise.reject(
        new Error(
          'request failed for https://secret.example?token=do-not-return'
        )
      )

    await expect(
      postAgentDispatchPoke(configuration, { fetch })
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: 'request_failed',
    })
  })
})
