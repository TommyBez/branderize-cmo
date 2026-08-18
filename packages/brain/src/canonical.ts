import {
  canonicalJson,
  sha256CanonicalJson,
  sha256Hex,
} from '@repo/canonical-json'

export type { CanonicalJson } from '@repo/canonical-json'

export const canonicalize = (value: unknown): string => canonicalJson(value)

export const sha256 = (value: string | Uint8Array): string => sha256Hex(value)

export const requestHash = (value: unknown): string =>
  sha256CanonicalJson(value)

export const operationKey = (namespace: string, requestId: string): string => {
  const normalizedNamespace = namespace.trim()
  const normalizedRequestId = requestId.trim()
  if (normalizedNamespace.length === 0 || normalizedRequestId.length === 0) {
    throw new TypeError('Operation namespace and request id must be non-empty')
  }
  return `${normalizedNamespace}:${sha256(normalizedRequestId)}`
}
