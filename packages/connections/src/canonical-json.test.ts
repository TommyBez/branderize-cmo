import { describe, expect, it } from 'vitest'

import { canonicalJson, sha256CanonicalJson } from './canonical-json'

describe('canonical JSON', () => {
  it('sorts object keys recursively while retaining array order', () => {
    const left = { a: true, z: [{ a: 1, b: 2 }] }
    const right = { a: true, z: [{ a: 1, b: 2 }] }

    expect(canonicalJson(left)).toBe('{"a":true,"z":[{"a":1,"b":2}]}')
    expect(sha256CanonicalJson(left)).toBe(sha256CanonicalJson(right))
  })

  it('rejects values outside JSON', () => {
    expect(() => canonicalJson({ invalid: undefined })).toThrow()
  })
})
