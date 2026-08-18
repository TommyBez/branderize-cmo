import { describe, expect, it } from 'vitest'

import { canonicalJson, sha256CanonicalJson } from './canonical-json'

const compatibilityVectors: readonly Readonly<{
  canonical: string
  hash: string
  value: unknown
}>[] = [
  {
    canonical: 'null',
    hash: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
    value: null,
  },
  {
    canonical: '{"a":{"c":null,"d":true},"z":[{"x":1,"y":2}]}',
    hash: '0ba180b58aef0986f81100d765aa2a70945d61f5df6025642c2f3852e7d33bef',
    value: { a: { c: null, d: true }, z: [{ x: 1, y: 2 }] },
  },
  {
    canonical: '["array order",2,1,false]',
    hash: 'eb12c33c14f099d38391e92684cf485146fbd5d6e1ccb5941f7ebb6f6f839868',
    value: ['array order', 2, 1, false],
  },
  {
    canonical: '{"é":"decomposed","quote":"\\"line\\nnext\\"","é":"composed"}',
    hash: 'dc86d1a61fdaaeb40a6161ef639c37a32dbbf60cfce8a820c1e33211b76cfabd',
    value: { é: 'decomposed', quote: '"line\nnext"', é: 'composed' },
  },
  {
    canonical: '0',
    hash: '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9',
    value: -0,
  },
  {
    canonical:
      '{"acceptedIntentRevision":3,"constraints":[{"kind":"constraint","text":"No paid media"}],"locale":"it-IT","pages":[{"path":"/about","title":"Chi siamo"}]}',
    hash: 'b9844c2ceb70a2f6e5c5d9dee623ab9dd89476bc9b8f307dd248b0338cb6f591',
    value: {
      acceptedIntentRevision: 3,
      constraints: [{ kind: 'constraint', text: 'No paid media' }],
      locale: 'it-IT',
      pages: [{ path: '/about', title: 'Chi siamo' }],
    },
  },
]

describe('canonical JSON compatibility', () => {
  it('preserves the persisted serialization and SHA-256 vectors', () => {
    for (const vector of compatibilityVectors) {
      expect(canonicalJson(vector.value)).toBe(vector.canonical)
      expect(sha256CanonicalJson(vector.value)).toBe(vector.hash)
    }
  })

  it('rejects values without stable JSON semantics', () => {
    expect(() => canonicalJson({ missing: undefined })).toThrow(
      'Canonical JSON does not accept undefined values'
    )
    expect(() => canonicalJson(Number.NaN)).toThrow(
      'Canonical JSON accepts only JSON-compatible values'
    )
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(
      'Canonical JSON accepts only JSON-compatible values'
    )
    expect(() => canonicalJson(new Date(0))).toThrow(
      'Canonical JSON accepts only JSON-compatible values'
    )
    expect(() => canonicalJson(new Array<unknown>(1))).toThrow(
      'Canonical JSON accepts only JSON-compatible values'
    )
  })
})
