import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CanonicalBlobStore } from './private-blob'
import {
  createRemoteAssetFetcher,
  mirrorRemoteAsset,
  type PinnedRemoteAssetRequest,
  type RemoteAssetError,
  type RemoteAssetFetcher,
  type RemoteAssetTransport,
} from './remote-assets'

const publicResolver = async (): Promise<readonly string[]> => ['93.184.216.34']

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
])

const policy = {
  maxBytes: 1024,
  maxRedirects: 2,
  timeoutMs: 1000,
}

const CANONICAL_PNG_KEY_PATTERN =
  /^brands\/018f47a6-72d3-7a93-b49a-d91f50dd1771\/artifacts\/sha256\/[0-9a-f]{64}\.png$/

afterEach(() => {
  vi.useRealTimers()
})

describe('remote asset fetcher', () => {
  it('validates every redirect and accepts bytes matching the declared MIME', async () => {
    const transport: RemoteAssetTransport = vi.fn(({ url }) => {
      if (url.toString() === 'https://cdn.example/logo') {
        return Promise.resolve(
          new Response(null, {
            headers: { location: '/logo.png' },
            status: 302,
          })
        )
      }
      return Promise.resolve(
        new Response(pngBytes, {
          headers: {
            'content-length': String(pngBytes.byteLength),
            'content-type': 'image/png; charset=binary',
          },
        })
      )
    })
    const fetcher = createRemoteAssetFetcher(policy, {
      resolveHostname: publicResolver,
      transport,
    })

    const result = await fetcher.download('https://cdn.example/logo')

    expect(result).toEqual({
      bytes: pngBytes,
      contentType: 'image/png',
      finalUrl: 'https://cdn.example/logo.png',
      sourceUrl: 'https://cdn.example/logo',
    })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('rejects a hostname resolving to a private address before fetching', async () => {
    const transport: RemoteAssetTransport = vi.fn()
    const fetcher = createRemoteAssetFetcher(policy, {
      resolveHostname: async () => ['127.0.0.1'],
      transport,
    })

    await expect(
      fetcher.download('https://assets.example/logo.png')
    ).rejects.toMatchObject({
      code: 'unsafe_url',
    } satisfies Partial<RemoteAssetError>)
    expect(transport).not.toHaveBeenCalled()
  })

  it('rejects a redirect that resolves to a private address', async () => {
    const transport: RemoteAssetTransport = vi.fn(() =>
      Promise.resolve(Response.redirect('https://127.0.0.1/logo.png', 302))
    )
    const fetcher = createRemoteAssetFetcher(policy, {
      resolveHostname: async (hostname) =>
        hostname === '127.0.0.1' ? ['127.0.0.1'] : ['93.184.216.34'],
      transport,
    })

    await expect(
      fetcher.download('https://assets.example/logo')
    ).rejects.toMatchObject({
      code: 'unsafe_url',
    } satisfies Partial<RemoteAssetError>)
    expect(transport).toHaveBeenCalledOnce()
  })

  it('rejects MIME declarations that do not match the bytes', async () => {
    const fetcher = createRemoteAssetFetcher(policy, {
      resolveHostname: publicResolver,
      transport: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'image/png' },
        }),
    })

    await expect(
      fetcher.download('https://assets.example/logo.png')
    ).rejects.toMatchObject({
      code: 'invalid_content',
    } satisfies Partial<RemoteAssetError>)
  })

  it('enforces the streaming byte limit when content length is absent', async () => {
    const fetcher = createRemoteAssetFetcher(
      { ...policy, maxBytes: 8 },
      {
        resolveHostname: publicResolver,
        transport: async () =>
          new Response(pngBytes, {
            headers: { 'content-type': 'image/png' },
          }),
      }
    )

    await expect(
      fetcher.download('https://assets.example/logo.png')
    ).rejects.toMatchObject({
      code: 'content_too_large',
    } satisfies Partial<RemoteAssetError>)
  })

  it('aborts a download at the configured deadline', async () => {
    vi.useFakeTimers()
    const transport: RemoteAssetTransport = () =>
      new Promise<Response>(() => undefined)
    const fetcher = createRemoteAssetFetcher(
      { ...policy, timeoutMs: 250 },
      { resolveHostname: publicResolver, transport }
    )

    const download = fetcher.download('https://assets.example/logo.png')
    const rejection = expect(download).rejects.toMatchObject({
      code: 'timeout',
    } satisfies Partial<RemoteAssetError>)
    await vi.advanceTimersByTimeAsync(250)

    await rejection
  })

  it.each([
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ] satisfies readonly Pick<PinnedRemoteAssetRequest, 'address' | 'family'>[])(
    'pins a validated IPv$family address into the transport',
    async (endpoint) => {
      const requests: PinnedRemoteAssetRequest[] = []
      const fetcher = createRemoteAssetFetcher(policy, {
        resolveHostname: async () => [endpoint.address],
        transport: (request) => {
          requests.push(request)
          return Promise.resolve(
            new Response(pngBytes, {
              headers: { 'content-type': 'image/png' },
            })
          )
        },
      })

      await fetcher.download('https://assets.example/logo.png')

      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject(endpoint)
    }
  )

  it('does not resolve the hostname again after selecting its public address', async () => {
    const resolveHostname = vi
      .fn<() => Promise<readonly string[]>>()
      .mockResolvedValueOnce(['93.184.216.34'])
      .mockResolvedValueOnce(['127.0.0.1'])
    const transport = vi.fn<RemoteAssetTransport>(({ address }) => {
      expect(address).toBe('93.184.216.34')
      return Promise.resolve(
        new Response(pngBytes, {
          headers: { 'content-type': 'image/png' },
        })
      )
    })
    const fetcher = createRemoteAssetFetcher(policy, {
      resolveHostname,
      transport,
    })

    await expect(
      fetcher.download('https://assets.example/logo.png')
    ).resolves.toMatchObject({ contentType: 'image/png' })
    expect(resolveHostname).toHaveBeenCalledOnce()
    expect(transport).toHaveBeenCalledOnce()
  })

  it('rejects a mixed public and private DNS answer before connecting', async () => {
    const transport = vi.fn<RemoteAssetTransport>()
    const fetcher = createRemoteAssetFetcher(policy, {
      resolveHostname: async () => ['93.184.216.34', '10.0.0.8'],
      transport,
    })

    await expect(
      fetcher.download('https://assets.example/logo.png')
    ).rejects.toMatchObject({
      code: 'unsafe_url',
    } satisfies Partial<RemoteAssetError>)
    expect(transport).not.toHaveBeenCalled()
  })

  it('rejects IPv4-mapped IPv6 addresses before connecting', async () => {
    const transport = vi.fn<RemoteAssetTransport>()
    const fetcher = createRemoteAssetFetcher(policy, {
      resolveHostname: async () => ['::ffff:10.0.0.8'],
      transport,
    })

    await expect(
      fetcher.download('https://assets.example/logo.png')
    ).rejects.toMatchObject({
      code: 'unsafe_url',
    } satisfies Partial<RemoteAssetError>)
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('remote asset mirroring', () => {
  it('uploads to a full-hash brand key and keeps upstream URLs in provenance only', async () => {
    const upload = vi.fn<CanonicalBlobStore['upload']>(async () => undefined)
    const blobStore: CanonicalBlobStore = {
      read: async () => ({ kind: 'not_found' }),
      upload,
    }
    const remoteAssets: RemoteAssetFetcher = {
      download: async () => ({
        bytes: pngBytes,
        contentType: 'image/png',
        finalUrl: 'https://cdn.example/logo.png',
        sourceUrl: 'https://example.com/logo',
      }),
    }

    const result = await mirrorRemoteAsset({
      blobStore,
      brandId: '018f47a6-72d3-7a93-b49a-d91f50dd1771',
      remoteAssets,
      sourceUrl: 'https://example.com/logo',
    })

    expect(result.canonical.blobKey).toMatch(CANONICAL_PNG_KEY_PATTERN)
    expect(result.canonical).not.toHaveProperty('url')
    expect(result.provenance.sourceUrl).toBe('https://example.com/logo')
    expect(upload).toHaveBeenCalledOnce()
  })
})
