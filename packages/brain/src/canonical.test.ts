import { describe, expect, it } from 'vitest'

import { canonicalize, operationKey, requestHash } from './canonical'

const OPERATION_KEY_PATTERN = /^intent-declare:[0-9a-f]{64}$/u

describe('canonical request identity', () => {
  it('sorts object keys recursively without reordering arrays', () => {
    const unordered = Object.fromEntries([
      [
        'z',
        [
          Object.fromEntries([
            ['y', 2],
            ['x', 1],
          ]),
        ],
      ],
      [
        'a',
        Object.fromEntries([
          ['d', true],
          ['c', null],
        ]),
      ],
    ])

    expect(canonicalize(unordered)).toBe(
      '{"a":{"c":null,"d":true},"z":[{"x":1,"y":2}]}'
    )
  })

  it('gives equivalent request objects the same hash', () => {
    const unordered = Object.fromEntries([
      ['b', 2],
      ['a', 1],
    ])

    expect(requestHash(unordered)).toBe(requestHash({ a: 1, b: 2 }))
  })

  it('namespaces a private digest instead of persisting a raw request id', () => {
    const key = operationKey('intent-declare', 'browser-request-01')

    expect(key).toMatch(OPERATION_KEY_PATTERN)
    expect(key).not.toContain('browser-request-01')
  })

  it('rejects values that cannot have stable JSON semantics', () => {
    expect(() => canonicalize({ missing: undefined })).toThrow(
      'Canonical JSON does not accept undefined values'
    )
  })
})
