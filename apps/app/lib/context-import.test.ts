import { BrainError } from '@repo/brain/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  claimContextBootstrapMock,
  commitContextBootstrapMock,
  importWebsiteMock,
  mirrorRemoteAssetMock,
  recoverContextBootstrapClaimMock,
} = vi.hoisted(() => ({
  claimContextBootstrapMock: vi.fn(),
  commitContextBootstrapMock: vi.fn(),
  importWebsiteMock: vi.fn(),
  mirrorRemoteAssetMock: vi.fn(),
  recoverContextBootstrapClaimMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@repo/brain/objects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/brain/objects')>()
  return {
    ...actual,
    claimContextBootstrap: claimContextBootstrapMock,
    commitContextBootstrap: commitContextBootstrapMock,
    recoverContextBootstrapClaim: recoverContextBootstrapClaimMock,
  }
})

vi.mock('@repo/connections/context-dev', () => ({
  createContextDevAdapter: vi.fn(() => ({
    importWebsite: importWebsiteMock,
  })),
}))

vi.mock('@repo/connections/remote-assets', () => ({
  createRemoteAssetFetcher: vi.fn(() => ({})),
  mirrorRemoteAsset: mirrorRemoteAssetMock,
}))

vi.mock('@repo/db', () => ({ db: {} }))

vi.mock('./blob', () => ({ canonicalBlobStore: {} }))

import { importCanonicalBrandContext } from './context-import'

const brandId = '10000000-0000-0000-0000-000000000001'
const systemActorId = '20000000-0000-0000-0000-000000000001'
const access = {
  brandId,
  humanActorId: '30000000-0000-0000-0000-000000000001',
  humanActorKey: 'human:user:owner',
  organizationId: 'organization:test',
  role: 'owner' as const,
  userId: 'user:owner',
}
const claim = {
  brandId,
  claimedAt: new Date('2026-08-17T20:00:00.000Z'),
  kind: 'claimed' as const,
  systemActorId,
  websiteUrl: 'https://brand.example.test',
}
const snapshot = {
  brandKit: {
    assetCandidates: [{ sourceUrl: 'https://assets.example.test/logo.png' }],
  },
  name: 'Brand snapshot',
}
const mirroredAsset = {
  canonical: {
    blobKey: `brands/${brandId}/artifacts/sha256/${'a'.repeat(64)}.png`,
    byteSize: 128,
    contentType: 'image/png',
    sha256: 'a'.repeat(64),
  },
  provenance: {
    finalUrl: 'https://assets.example.test/logo.png',
    sourceUrl: 'https://assets.example.test/logo.png',
  },
}
const receipt = {
  actionId: '40000000-0000-0000-0000-000000000001',
  artifactObjectIds: ['50000000-0000-0000-0000-000000000001'],
  brandContextObjectId: '60000000-0000-0000-0000-000000000001',
  outcome: 'context_bootstrapped' as const,
}

describe('canonical Brand Context import coordination', () => {
  beforeEach(() => {
    vi.stubEnv('CONTEXT_DEV_API_KEY', 'context-dev-test-key')
    claimContextBootstrapMock.mockReset()
    commitContextBootstrapMock.mockReset()
    importWebsiteMock.mockReset()
    mirrorRemoteAssetMock.mockReset()
    recoverContextBootstrapClaimMock.mockReset()

    claimContextBootstrapMock.mockResolvedValue(claim)
    commitContextBootstrapMock.mockResolvedValue(receipt)
    importWebsiteMock.mockResolvedValue(snapshot)
    mirrorRemoteAssetMock.mockResolvedValue(mirroredAsset)
    recoverContextBootstrapClaimMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects a concurrent request before provider or Blob side effects', async () => {
    claimContextBootstrapMock
      .mockResolvedValueOnce(claim)
      .mockRejectedValueOnce(
        new BrainError('already_claimed', 'Context import already claimed')
      )

    const results = await Promise.allSettled([
      importCanonicalBrandContext({ access }),
      importCanonicalBrandContext({ access }),
    ])

    expect(results.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ])
    expect(claimContextBootstrapMock).toHaveBeenCalledTimes(2)
    expect(importWebsiteMock).toHaveBeenCalledTimes(1)
    expect(mirrorRemoteAssetMock).toHaveBeenCalledTimes(1)
    expect(commitContextBootstrapMock).toHaveBeenCalledTimes(1)
    expect(recoverContextBootstrapClaimMock).not.toHaveBeenCalled()
  })

  it('recovers the claimed Brand to incomplete when provider work fails', async () => {
    const providerError = new Error('Context.dev unavailable')
    importWebsiteMock.mockRejectedValue(providerError)

    await expect(importCanonicalBrandContext({ access })).rejects.toBe(
      providerError
    )

    expect(recoverContextBootstrapClaimMock).toHaveBeenCalledWith({
      access: {
        brandId,
        systemActorId,
        systemActorKey: 'system:context-dev',
      },
      claim,
      database: expect.anything(),
    })
    expect(commitContextBootstrapMock).not.toHaveBeenCalled()
  })

  it('recovers the claimed Brand to incomplete when commit fails', async () => {
    const commitError = new Error('Canonical commit failed')
    commitContextBootstrapMock.mockRejectedValue(commitError)

    await expect(importCanonicalBrandContext({ access })).rejects.toBe(
      commitError
    )

    expect(importWebsiteMock).toHaveBeenCalledTimes(1)
    expect(mirrorRemoteAssetMock).toHaveBeenCalledTimes(1)
    expect(recoverContextBootstrapClaimMock).toHaveBeenCalledWith({
      access: {
        brandId,
        systemActorId,
        systemActorKey: 'system:context-dev',
      },
      claim,
      database: expect.anything(),
    })
  })

  it('replays a committed receipt without provider configuration or calls', async () => {
    vi.stubEnv('CONTEXT_DEV_API_KEY', '')
    claimContextBootstrapMock.mockResolvedValue({
      kind: 'replay',
      receipt,
    })

    await expect(importCanonicalBrandContext({ access })).resolves.toEqual(
      receipt
    )

    expect(importWebsiteMock).not.toHaveBeenCalled()
    expect(mirrorRemoteAssetMock).not.toHaveBeenCalled()
    expect(commitContextBootstrapMock).not.toHaveBeenCalled()
    expect(recoverContextBootstrapClaimMock).not.toHaveBeenCalled()
  })

  it('keeps the claim until every started Blob mirror settles', async () => {
    const firstMirrorError = new Error('First mirror failed')
    let resolveSecondMirror: (value: typeof mirroredAsset) => void = () => {
      throw new Error('The second mirror was resolved before initialization')
    }
    const secondMirror = new Promise<typeof mirroredAsset>((resolve) => {
      resolveSecondMirror = resolve
    })
    importWebsiteMock.mockResolvedValue({
      ...snapshot,
      brandKit: {
        assetCandidates: [
          { sourceUrl: 'https://assets.example.test/first.png' },
          { sourceUrl: 'https://assets.example.test/second.png' },
        ],
      },
    })
    mirrorRemoteAssetMock
      .mockRejectedValueOnce(firstMirrorError)
      .mockReturnValueOnce(secondMirror)

    const importResult = importCanonicalBrandContext({ access })
    const rejectedImport = expect(importResult).rejects.toBe(firstMirrorError)
    await vi.waitFor(() => {
      expect(mirrorRemoteAssetMock).toHaveBeenCalledTimes(2)
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(recoverContextBootstrapClaimMock).not.toHaveBeenCalled()

    resolveSecondMirror(mirroredAsset)
    await rejectedImport
    expect(recoverContextBootstrapClaimMock).toHaveBeenCalledTimes(1)
  })
})
