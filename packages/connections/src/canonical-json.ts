import {
  canonicalJson as encodeCanonicalJson,
  sha256CanonicalJson as hashCanonicalJson,
} from '@repo/canonical-json'

export const compareCanonicalStrings = (
  left: string,
  right: string
): number => {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

export const canonicalJson = (value: unknown): string =>
  encodeCanonicalJson(value)

export const sha256CanonicalJson = (value: unknown): string =>
  hashCanonicalJson(value)
