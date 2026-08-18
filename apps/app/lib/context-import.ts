import 'server-only'

import type { TrustedMemberAccess } from '@repo/brain/context'
import {
  type ContextBootstrapReceipt,
  claimContextBootstrap,
  commitContextBootstrap,
  commitContextBootstrapInputSchema,
  recoverContextBootstrapClaim,
} from '@repo/brain/objects'
import { createContextDevAdapter } from '@repo/connections/context-dev'
import {
  createRemoteAssetFetcher,
  mirrorRemoteAsset,
} from '@repo/connections/remote-assets'
import { db } from '@repo/db'
import { z } from 'zod'

import { canonicalBlobStore } from './blob'

const contextDevKeySchema = z.string().trim().min(1).max(4096)

export class ContextImportUnavailableError extends Error {
  constructor() {
    super('The Context.dev import is not configured for this environment')
    this.name = 'ContextImportUnavailableError'
  }
}

class ContextImportRecoveryError extends Error {
  readonly importError: unknown

  constructor(importError: unknown, options: ErrorOptions) {
    super('Context import failed and its claim could not be recovered', options)
    this.importError = importError
    this.name = 'ContextImportRecoveryError'
  }
}

const readContextDevKey = (): string => {
  const parsed = contextDevKeySchema.safeParse(process.env.CONTEXT_DEV_API_KEY)
  if (!parsed.success) {
    throw new ContextImportUnavailableError()
  }
  return parsed.data
}

export const importCanonicalBrandContext = async ({
  access,
}: {
  readonly access: TrustedMemberAccess
}): Promise<ContextBootstrapReceipt> => {
  const claim = await claimContextBootstrap({ access, database: db })
  if (claim.kind === 'replay') {
    return claim.receipt
  }
  const systemAccess = {
    brandId: claim.brandId,
    systemActorId: claim.systemActorId,
    systemActorKey: 'system:context-dev' as const,
  }

  try {
    const apiKey = readContextDevKey()
    const adapter = createContextDevAdapter({
      apiKey,
      configuration: {
        crawl: { maxDepth: 2, maxPages: 20, stopAfterMs: 90_000 },
        tags: ['branderize', 'phase-0'],
        timeoutMs: 110_000,
      },
    })
    const remoteAssets = createRemoteAssetFetcher({
      maxBytes: 12_000_000,
      maxRedirects: 4,
      timeoutMs: 25_000,
    })

    const snapshot = await adapter.importWebsite({
      websiteUrl: claim.websiteUrl,
    })
    const mirroredAssets = (
      await Promise.allSettled(
        snapshot.brandKit.assetCandidates.map(
          async ({ sourceUrl }) =>
            await mirrorRemoteAsset({
              blobStore: canonicalBlobStore,
              brandId: claim.brandId,
              remoteAssets,
              sourceUrl,
            })
        )
      )
    ).map((result) => {
      if (result.status === 'rejected') {
        throw result.reason
      }
      return result.value
    })

    const input = commitContextBootstrapInputSchema.parse({
      artifacts: mirroredAssets.map(({ canonical, provenance }) => ({
        blobKey: canonical.blobKey,
        byteSize: canonical.byteSize,
        contentType: canonical.contentType,
        finalUrl: provenance.finalUrl,
        sha256: canonical.sha256,
        sourceUrl: provenance.sourceUrl,
      })),
      snapshot,
      websiteUrl: claim.websiteUrl,
    })

    return await commitContextBootstrap({
      access: systemAccess,
      claim,
      database: db,
      input,
    })
  } catch (error) {
    try {
      await recoverContextBootstrapClaim({
        access: systemAccess,
        claim,
        database: db,
      })
    } catch (recoveryError) {
      throw new ContextImportRecoveryError(error, { cause: recoveryError })
    }
    throw error
  }
}
