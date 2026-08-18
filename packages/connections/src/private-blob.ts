import { createHash } from 'node:crypto'

import type { BlobKey, CanonicalAsset } from './domain'
import { blobKeySchema, canonicalAssetSchema } from './domain'

export interface PrivateBlobPutResult {
  readonly pathname: string
}

export type PrivateBlobGetResult =
  | {
      readonly blob: {
        readonly contentType: string
        readonly etag: string
      }
      readonly statusCode: 200
      readonly stream: ReadableStream<Uint8Array>
    }
  | {
      readonly blob: {
        readonly contentType: null
        readonly etag: string
      }
      readonly statusCode: 304
      readonly stream: null
    }

export interface PrivateBlobSdk {
  readonly get: (
    pathname: string,
    options: {
      readonly access: 'private'
      readonly ifNoneMatch?: string
    }
  ) => Promise<PrivateBlobGetResult | null>
  readonly put: (
    pathname: string,
    body: Uint8Array,
    options: {
      readonly access: 'private'
      readonly addRandomSuffix: false
      readonly allowOverwrite: true
      readonly contentType: string
    }
  ) => Promise<PrivateBlobPutResult>
}

export type PrivateBlobReadResult =
  | {
      readonly kind: 'found'
      readonly contentType: string
      readonly etag: string
      readonly stream: ReadableStream<Uint8Array>
    }
  | {
      readonly kind: 'not_modified'
      readonly etag: string
    }
  | { readonly kind: 'not_found' }

export interface CanonicalBlobStore {
  readonly read: (input: {
    readonly blobKey: BlobKey
    readonly ifNoneMatch?: string
  }) => Promise<PrivateBlobReadResult>
  readonly upload: (input: {
    readonly asset: CanonicalAsset
    readonly bytes: Uint8Array
  }) => Promise<void>
}

export const createPrivateBlobAdapter = (
  sdk: PrivateBlobSdk
): CanonicalBlobStore => ({
  read: async ({ blobKey, ifNoneMatch }) => {
    const validatedBlobKey = blobKeySchema.parse(blobKey)
    const result = await sdk.get(validatedBlobKey, {
      access: 'private',
      ...(ifNoneMatch === undefined ? {} : { ifNoneMatch }),
    })

    if (result === null) {
      return { kind: 'not_found' }
    }

    if (result.statusCode === 304) {
      return { etag: result.blob.etag, kind: 'not_modified' }
    }

    return {
      contentType: result.blob.contentType,
      etag: result.blob.etag,
      kind: 'found',
      stream: result.stream,
    }
  },
  upload: async ({ asset, bytes }) => {
    const validatedAsset = canonicalAssetSchema.parse(asset)
    if (bytes.byteLength !== validatedAsset.byteSize) {
      throw new Error('Blob byte length does not match canonical metadata')
    }
    const byteHash = createHash('sha256').update(bytes).digest('hex')
    if (byteHash !== validatedAsset.sha256) {
      throw new Error('Blob bytes do not match the canonical content hash')
    }

    const result = await sdk.put(validatedAsset.blobKey, bytes, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: validatedAsset.contentType,
    })

    if (result.pathname !== validatedAsset.blobKey) {
      throw new Error('Blob provider changed the canonical pathname')
    }
  },
})
