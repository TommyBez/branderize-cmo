import { describe, expect, it, vi } from 'vitest'

import { blobKeySchema, canonicalAssetSchema } from './domain'
import { createPrivateBlobAdapter, type PrivateBlobSdk } from './private-blob'

const asset = canonicalAssetSchema.parse({
  blobKey:
    'brands/018f47a6-72d3-7a93-b49a-d91f50dd1771/artifacts/sha256/039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81.png',
  byteSize: 3,
  contentType: 'image/png',
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
})

describe('private Blob adapter', () => {
  it('uses an overwrite-safe deterministic private pathname and discards URLs', async () => {
    const put = vi.fn<PrivateBlobSdk['put']>(async (pathname) => ({ pathname }))
    const sdk: PrivateBlobSdk = {
      get: async () => null,
      put,
    }
    const store = createPrivateBlobAdapter(sdk)

    await store.upload({ asset, bytes: new Uint8Array([1, 2, 3]) })

    expect(put).toHaveBeenCalledWith(asset.blobKey, new Uint8Array([1, 2, 3]), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'image/png',
    })
  })

  it('passes only the canonical key into private reads', async () => {
    const key = blobKeySchema.parse(asset.blobKey)
    const get = vi.fn<PrivateBlobSdk['get']>(async () => ({
      blob: { contentType: 'image/png', etag: 'etag-1' },
      statusCode: 200,
      stream: new ReadableStream<Uint8Array>(),
    }))
    const sdk: PrivateBlobSdk = {
      get,
      put: async (pathname) => ({ pathname }),
    }

    const result = await createPrivateBlobAdapter(sdk).read({
      blobKey: key,
      ifNoneMatch: 'etag-0',
    })

    expect(result.kind).toBe('found')
    expect(get).toHaveBeenCalledWith(key, {
      access: 'private',
      ifNoneMatch: 'etag-0',
    })
  })

  it('maps a conditional private read without requiring a stream', async () => {
    const key = blobKeySchema.parse(asset.blobKey)
    const sdk: PrivateBlobSdk = {
      get: async () => ({
        blob: { contentType: null, etag: 'etag-1' },
        statusCode: 304,
        stream: null,
      }),
      put: async (pathname) => ({ pathname }),
    }

    const result = await createPrivateBlobAdapter(sdk).read({
      blobKey: key,
      ifNoneMatch: 'etag-1',
    })

    expect(result).toEqual({ etag: 'etag-1', kind: 'not_modified' })
  })

  it('fails when the provider changes the requested pathname', async () => {
    const sdk: PrivateBlobSdk = {
      get: async () => null,
      put: async () => ({ pathname: 'randomized.png' }),
    }

    await expect(
      createPrivateBlobAdapter(sdk).upload({
        asset,
        bytes: new Uint8Array([1, 2, 3]),
      })
    ).rejects.toThrow('canonical pathname')
  })

  it('rejects bytes that do not match the canonical hash before upload', async () => {
    const put = vi.fn<PrivateBlobSdk['put']>(async (pathname) => ({ pathname }))
    const sdk: PrivateBlobSdk = {
      get: async () => null,
      put,
    }

    await expect(
      createPrivateBlobAdapter(sdk).upload({
        asset,
        bytes: new Uint8Array([3, 2, 1]),
      })
    ).rejects.toThrow('canonical content hash')
    expect(put).not.toHaveBeenCalled()
  })
})
