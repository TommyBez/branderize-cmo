import { Buffer } from 'node:buffer'

import { blobKeySchema, canonicalAssetSchema } from '@repo/connections/domain'
import { describe, expect, it, vi } from 'vitest'

const { getMock, putMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@repo/db', () => ({ db: {} }))
vi.mock('@vercel/blob', () => ({ get: getMock, put: putMock }))
vi.mock('./auth', () => ({
  appEnvironment: { BLOB_STORE_ID: 'store_phase0_test' },
}))

import { canonicalBlobStore } from './blob'

const BLOB_KEY = blobKeySchema.parse(
  'brands/018f47a6-72d3-7a93-b49a-d91f50dd1771/artifacts/sha256/039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81.png'
)
const ASSET = canonicalAssetSchema.parse({
  blobKey: BLOB_KEY,
  byteSize: 3,
  contentType: 'image/png',
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
})

describe('canonical private Blob store', () => {
  it('bounds a private upload and keeps the configured store identity', async () => {
    putMock.mockResolvedValue({ pathname: BLOB_KEY })

    await canonicalBlobStore.upload({
      asset: ASSET,
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(putMock).toHaveBeenCalledWith(
      BLOB_KEY,
      Buffer.from([1, 2, 3]),
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
        access: 'private',
        storeId: 'store_phase0_test',
      })
    )
  })

  it('bounds private reads through the same store identity', async () => {
    getMock.mockResolvedValue(null)

    await expect(
      canonicalBlobStore.read({ blobKey: BLOB_KEY })
    ).resolves.toEqual({ kind: 'not_found' })

    expect(getMock).toHaveBeenCalledWith(
      BLOB_KEY,
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
        access: 'private',
        storeId: 'store_phase0_test',
      })
    )
  })
})
