import { describe, expect, it } from 'vitest'

import { brandIdSchema, canonicalAssetSchema, sha256HexSchema } from './domain'

const BRAND_ID = '018f47a6-72d3-7a93-b49a-d91f50dd1771'
const SHA256 = sha256HexSchema.parse('a'.repeat(64))

describe('connection domain contracts', () => {
  it('normalizes UUID inputs before they enter canonical paths', () => {
    expect(brandIdSchema.parse(BRAND_ID.toUpperCase())).toBe(BRAND_ID)
  })

  it('rejects a key whose extension disagrees with canonical MIME', () => {
    expect(() =>
      canonicalAssetSchema.parse({
        blobKey: `brands/${BRAND_ID}/artifacts/sha256/${SHA256}.jpg`,
        byteSize: 1,
        contentType: 'image/png',
        sha256: SHA256,
      })
    ).toThrow('canonical hash and content type')
  })
})
