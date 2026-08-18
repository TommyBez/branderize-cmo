import 'server-only'

import { Buffer } from 'node:buffer'

import {
  canonicalArtifactRecordSchema,
  createAuthenticatedAssetDeliveryService,
} from '@repo/connections/delivery'
import {
  createPrivateBlobAdapter,
  type PrivateBlobSdk,
} from '@repo/connections/private-blob'
import { db } from '@repo/db'
import { member } from '@repo/db/schema/auth'
import { brands, objects } from '@repo/db/schema/domain'
import { get, put } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'

import { appEnvironment } from './auth'

const PRIVATE_BLOB_OPERATION_TIMEOUT_MS = 25_000

const getCanonicalBytes: PrivateBlobSdk['get'] = async (pathname, options) =>
  await get(pathname, {
    ...options,
    abortSignal: AbortSignal.timeout(PRIVATE_BLOB_OPERATION_TIMEOUT_MS),
    storeId: appEnvironment.BLOB_STORE_ID,
  })

const putCanonicalBytes: PrivateBlobSdk['put'] = async (
  pathname,
  bytes,
  options
) =>
  await put(pathname, Buffer.from(bytes), {
    ...options,
    abortSignal: AbortSignal.timeout(PRIVATE_BLOB_OPERATION_TIMEOUT_MS),
    storeId: appEnvironment.BLOB_STORE_ID,
  })

export const canonicalBlobStore = createPrivateBlobAdapter({
  get: getCanonicalBytes,
  put: putCanonicalBytes,
})

export const assetDeliveryService = createAuthenticatedAssetDeliveryService({
  artifacts: {
    findCanonicalArtifact: async ({ artifactId, brandId }) => {
      const [artifact] = await db
        .select({
          artifactId: objects.id,
          blobKey: objects.blobKey,
          brandId: objects.brandId,
          byteSize: objects.blobByteSize,
          contentType: objects.blobContentType,
          sha256: objects.blobSha256,
        })
        .from(objects)
        .where(
          and(
            eq(objects.id, artifactId),
            eq(objects.brandId, brandId),
            eq(objects.type, 'artifact')
          )
        )
        .limit(1)

      if (artifact === undefined) {
        return null
      }
      const parsed = canonicalArtifactRecordSchema.safeParse(artifact)
      return parsed.success ? parsed.data : null
    },
  },
  blobStore: canonicalBlobStore,
  membership: {
    canReadBrand: async ({ brandId, userId }) => {
      const [currentMember] = await db
        .select({ userId: member.userId })
        .from(brands)
        .innerJoin(
          member,
          and(
            eq(member.organizationId, brands.organizationId),
            eq(member.userId, userId)
          )
        )
        .where(eq(brands.id, brandId))
        .limit(1)
      return currentMember !== undefined
    },
  },
})
