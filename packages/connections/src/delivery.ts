import { z } from 'zod'
import type { ArtifactId, BrandId, UserId } from './domain'
import {
  artifactIdSchema,
  binaryContentTypeExtensions,
  binaryContentTypeSchema,
  blobKeySchema,
  brandIdSchema,
  sha256HexSchema,
  userIdSchema,
} from './domain'
import type { CanonicalBlobStore } from './private-blob'

const authenticatedPrincipalSchema = z
  .object({
    kind: z.literal('authenticated'),
    userId: userIdSchema,
  })
  .strict()

export const assetDeliveryRequestSchema = z
  .object({
    artifactId: artifactIdSchema,
    brandId: brandIdSchema,
    delivery: z.enum(['download', 'preview']),
    ifNoneMatch: z.string().min(1).max(512).optional(),
  })
  .strict()

export const canonicalArtifactRecordSchema = z
  .object({
    artifactId: artifactIdSchema,
    blobKey: blobKeySchema,
    brandId: brandIdSchema,
    byteSize: z.number().int().positive(),
    contentType: binaryContentTypeSchema,
    sha256: sha256HexSchema,
  })
  .strict()

export type AuthenticatedPrincipal = z.infer<
  typeof authenticatedPrincipalSchema
>
export type AssetDeliveryRequest = z.infer<typeof assetDeliveryRequestSchema>
export type CanonicalArtifactRecord = z.infer<
  typeof canonicalArtifactRecordSchema
>

export interface BrandMembershipAuthorizer {
  readonly canReadBrand: (input: {
    readonly brandId: BrandId
    readonly userId: UserId
  }) => Promise<boolean>
}

export interface CanonicalArtifactReader {
  readonly findCanonicalArtifact: (input: {
    readonly artifactId: ArtifactId
    readonly brandId: BrandId
  }) => Promise<CanonicalArtifactRecord | null>
}

export interface AssetDeliveryDependencies {
  readonly artifacts: CanonicalArtifactReader
  readonly blobStore: Pick<CanonicalBlobStore, 'read'>
  readonly membership: BrandMembershipAuthorizer
}

export type AssetDeliveryResult =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'invalid_request' }
  | { readonly kind: 'not_found' }
  | {
      readonly kind: 'not_modified'
      readonly headers: Readonly<Record<string, string>>
    }
  | {
      readonly kind: 'ready'
      readonly headers: Readonly<Record<string, string>>
      readonly stream: ReadableStream<Uint8Array>
    }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'unavailable' }

const artifactMatchesCanonicalPath = (
  artifact: CanonicalArtifactRecord
): boolean => {
  const extension = binaryContentTypeExtensions[artifact.contentType]
  const expectedPath = `brands/${artifact.brandId}/artifacts/sha256/${artifact.sha256}.${extension}`
  return artifact.blobKey === expectedPath
}

const responseHeaders = ({
  artifact,
  delivery,
  etag,
}: {
  readonly artifact: CanonicalArtifactRecord
  readonly delivery: AssetDeliveryRequest['delivery']
  readonly etag: string
}): Readonly<Record<string, string>> => {
  const disposition = delivery === 'download' ? 'attachment' : 'inline'
  const extension = binaryContentTypeExtensions[artifact.contentType]
  return {
    'cache-control': 'private, no-cache',
    'content-disposition': `${disposition}; filename="${artifact.artifactId}.${extension}"`,
    'content-security-policy': "default-src 'none'; sandbox",
    'content-type': artifact.contentType,
    etag,
    'x-content-type-options': 'nosniff',
  }
}

export interface AuthenticatedAssetDeliveryService {
  readonly deliver: (input: {
    readonly principal: unknown
    readonly request: unknown
  }) => Promise<AssetDeliveryResult>
}

export const createAuthenticatedAssetDeliveryService = (
  dependencies: AssetDeliveryDependencies
): AuthenticatedAssetDeliveryService => ({
  deliver: async ({ principal: principalInput, request: requestInput }) => {
    const principal = authenticatedPrincipalSchema.safeParse(principalInput)
    if (!principal.success) {
      return { kind: 'unauthenticated' }
    }

    const request = assetDeliveryRequestSchema.safeParse(requestInput)
    if (!request.success) {
      return { kind: 'invalid_request' }
    }

    const canRead = await dependencies.membership.canReadBrand({
      brandId: request.data.brandId,
      userId: principal.data.userId,
    })
    if (!canRead) {
      return { kind: 'forbidden' }
    }

    const artifact = await dependencies.artifacts.findCanonicalArtifact({
      artifactId: request.data.artifactId,
      brandId: request.data.brandId,
    })
    if (artifact === null) {
      return { kind: 'not_found' }
    }

    const parsedArtifact = canonicalArtifactRecordSchema.safeParse(artifact)
    if (
      !parsedArtifact.success ||
      parsedArtifact.data.artifactId !== request.data.artifactId ||
      parsedArtifact.data.brandId !== request.data.brandId ||
      !artifactMatchesCanonicalPath(parsedArtifact.data)
    ) {
      return { kind: 'unavailable' }
    }

    const blob = await dependencies.blobStore.read({
      blobKey: parsedArtifact.data.blobKey,
      ...(request.data.ifNoneMatch === undefined
        ? {}
        : { ifNoneMatch: request.data.ifNoneMatch }),
    })
    if (blob.kind === 'not_found') {
      return { kind: 'unavailable' }
    }

    const headers = responseHeaders({
      artifact: parsedArtifact.data,
      delivery: request.data.delivery,
      etag: blob.etag,
    })
    if (blob.kind === 'not_modified') {
      return { headers, kind: 'not_modified' }
    }

    if (blob.contentType !== parsedArtifact.data.contentType) {
      return { kind: 'unavailable' }
    }

    return { headers, kind: 'ready', stream: blob.stream }
  },
})
