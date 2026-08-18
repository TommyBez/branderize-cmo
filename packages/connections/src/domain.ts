import { z } from 'zod'

const BLOB_KEY_PATTERN =
  /^brands\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/artifacts\/sha256\/[0-9a-f]{64}\.(?:gif|jpg|mp4|pdf|png|svg|webp)$/

export const brandIdSchema = z
  .uuid()
  .transform((value) => value.toLowerCase())
  .brand<'BrandId'>()
export const artifactIdSchema = z
  .uuid()
  .transform((value) => value.toLowerCase())
  .brand<'ArtifactId'>()
export const userIdSchema = z.string().trim().min(1).max(128).brand<'UserId'>()
export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<'Sha256Hex'>()
export const blobKeySchema = z
  .string()
  .min(1)
  .max(512)
  .regex(BLOB_KEY_PATTERN)
  .brand<'BlobKey'>()

export const binaryContentTypeSchema = z.enum([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'video/mp4',
])

export const binaryContentTypeExtensions = {
  'application/pdf': 'pdf',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
} as const satisfies Record<z.infer<typeof binaryContentTypeSchema>, string>

export const canonicalAssetSchema = z
  .object({
    blobKey: blobKeySchema,
    byteSize: z.number().int().positive(),
    contentType: binaryContentTypeSchema,
    sha256: sha256HexSchema,
  })
  .strict()
  .superRefine((asset, context) => {
    const extension = binaryContentTypeExtensions[asset.contentType]
    const expectedSuffix = `/artifacts/sha256/${asset.sha256}.${extension}`
    if (!asset.blobKey.endsWith(expectedSuffix)) {
      context.addIssue({
        code: 'custom',
        message: 'Blob key does not match canonical hash and content type',
        path: ['blobKey'],
      })
    }
  })

export const assetProvenanceSchema = z
  .object({
    finalUrl: z.url(),
    sourceUrl: z.url(),
  })
  .strict()

export const mirroredAssetSchema = z
  .object({
    canonical: canonicalAssetSchema,
    provenance: assetProvenanceSchema,
  })
  .strict()

export type ArtifactId = z.infer<typeof artifactIdSchema>
export type BinaryContentType = z.infer<typeof binaryContentTypeSchema>
export type BlobKey = z.infer<typeof blobKeySchema>
export type BrandId = z.infer<typeof brandIdSchema>
export type CanonicalAsset = z.infer<typeof canonicalAssetSchema>
export type MirroredAsset = z.infer<typeof mirroredAssetSchema>
export type Sha256Hex = z.infer<typeof sha256HexSchema>
export type UserId = z.infer<typeof userIdSchema>
