import { describe, expect, it, vi } from 'vitest'

import {
  type AssetDeliveryDependencies,
  canonicalArtifactRecordSchema,
  createAuthenticatedAssetDeliveryService,
} from './delivery'

const brandId = '018f47a6-72d3-7a93-b49a-d91f50dd1771'
const artifactId = '018f47a6-72d3-7a93-b49a-d91f50dd1882'
const sha256 = 'a'.repeat(64)

const artifact = canonicalArtifactRecordSchema.parse({
  artifactId,
  blobKey: `brands/${brandId}/artifacts/sha256/${sha256}.png`,
  brandId,
  byteSize: 9,
  contentType: 'image/png',
  sha256,
})

const principal = { kind: 'authenticated', userId: 'user-1' }
const request = { artifactId, brandId, delivery: 'preview' }

const createDependencies = (): AssetDeliveryDependencies => ({
  artifacts: {
    findCanonicalArtifact: async () => artifact,
  },
  blobStore: {
    read: async () => ({
      contentType: 'image/png',
      etag: 'etag-1',
      kind: 'found',
      stream: new ReadableStream<Uint8Array>(),
    }),
  },
  membership: {
    canReadBrand: async () => true,
  },
})

describe('authenticated asset delivery', () => {
  it('rejects an unauthenticated principal before tenant or Blob reads', async () => {
    const dependencies = createDependencies()
    const canReadBrand = vi.spyOn(dependencies.membership, 'canReadBrand')
    const findArtifact = vi.spyOn(
      dependencies.artifacts,
      'findCanonicalArtifact'
    )

    const result = await createAuthenticatedAssetDeliveryService(
      dependencies
    ).deliver({ principal: null, request })

    expect(result).toEqual({ kind: 'unauthenticated' })
    expect(canReadBrand).not.toHaveBeenCalled()
    expect(findArtifact).not.toHaveBeenCalled()
  })

  it('authorizes current membership before resolving the Artifact', async () => {
    const baseDependencies = createDependencies()
    const dependencies: AssetDeliveryDependencies = {
      ...baseDependencies,
      membership: { canReadBrand: vi.fn(async () => false) },
    }
    const findArtifact = vi.spyOn(
      dependencies.artifacts,
      'findCanonicalArtifact'
    )

    const result = await createAuthenticatedAssetDeliveryService(
      dependencies
    ).deliver({ principal, request })

    expect(result).toEqual({ kind: 'forbidden' })
    expect(findArtifact).not.toHaveBeenCalled()
  })

  it('uses an exact brand-scoped Artifact lookup and serves only its Blob key', async () => {
    const dependencies = createDependencies()
    const findArtifact = vi.spyOn(
      dependencies.artifacts,
      'findCanonicalArtifact'
    )
    const readBlob = vi.spyOn(dependencies.blobStore, 'read')

    const result = await createAuthenticatedAssetDeliveryService(
      dependencies
    ).deliver({ principal, request })

    expect(result.kind).toBe('ready')
    expect(findArtifact).toHaveBeenCalledWith({ artifactId, brandId })
    expect(readBlob).toHaveBeenCalledWith({ blobKey: artifact.blobKey })
    if (result.kind === 'ready') {
      expect(result.headers).toMatchObject({
        'cache-control': 'private, no-cache',
        'content-type': 'image/png',
        'x-content-type-options': 'nosniff',
      })
      expect(result.headers).not.toHaveProperty('location')
    }
  })

  it('fails closed when Blob metadata disagrees with canonical metadata', async () => {
    const baseDependencies = createDependencies()
    const dependencies: AssetDeliveryDependencies = {
      ...baseDependencies,
      blobStore: {
        read: async () => ({
          contentType: 'image/jpeg',
          etag: 'etag-1',
          kind: 'found',
          stream: new ReadableStream<Uint8Array>(),
        }),
      },
    }

    const result = await createAuthenticatedAssetDeliveryService(
      dependencies
    ).deliver({ principal, request })

    expect(result).toEqual({ kind: 'unavailable' })
  })

  it('fails closed when the reader returns a different Artifact id', async () => {
    const wrongArtifact = canonicalArtifactRecordSchema.parse({
      ...artifact,
      artifactId: '018f47a6-72d3-7a93-b49a-d91f50dd2994',
    })
    const baseDependencies = createDependencies()
    const dependencies: AssetDeliveryDependencies = {
      ...baseDependencies,
      artifacts: { findCanonicalArtifact: async () => wrongArtifact },
    }
    const readBlob = vi.spyOn(dependencies.blobStore, 'read')

    const result = await createAuthenticatedAssetDeliveryService(
      dependencies
    ).deliver({ principal, request })

    expect(result).toEqual({ kind: 'unavailable' })
    expect(readBlob).not.toHaveBeenCalled()
  })

  it('fails closed when the canonical key extension disagrees with MIME', async () => {
    const wrongArtifact = canonicalArtifactRecordSchema.parse({
      ...artifact,
      blobKey: `brands/${brandId}/artifacts/sha256/${sha256}.jpg`,
    })
    const baseDependencies = createDependencies()
    const dependencies: AssetDeliveryDependencies = {
      ...baseDependencies,
      artifacts: { findCanonicalArtifact: async () => wrongArtifact },
    }
    const readBlob = vi.spyOn(dependencies.blobStore, 'read')

    const result = await createAuthenticatedAssetDeliveryService(
      dependencies
    ).deliver({ principal, request })

    expect(result).toEqual({ kind: 'unavailable' })
    expect(readBlob).not.toHaveBeenCalled()
  })

  it('fails cross-brand requests without consulting Blob', async () => {
    const baseDependencies = createDependencies()
    const dependencies: AssetDeliveryDependencies = {
      ...baseDependencies,
      artifacts: { findCanonicalArtifact: async () => null },
    }
    const readBlob = vi.spyOn(dependencies.blobStore, 'read')

    const result = await createAuthenticatedAssetDeliveryService(
      dependencies
    ).deliver({
      principal,
      request: {
        ...request,
        brandId: '018f47a6-72d3-7a93-b49a-d91f50dd1993',
      },
    })

    expect(result).toEqual({ kind: 'not_found' })
    expect(readBlob).not.toHaveBeenCalled()
  })
})
