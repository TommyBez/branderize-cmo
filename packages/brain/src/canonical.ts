import { createHash } from 'node:crypto'

import { z } from 'zod'

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
])

export type CanonicalJson =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalJson[]
  | Readonly<{ [key: string]: CanonicalJson }>

const normalizeJson = (value: unknown): CanonicalJson => {
  const primitive = jsonPrimitiveSchema.safeParse(value)
  if (primitive.success) {
    return primitive.data
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry))
  }

  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Canonical JSON accepts only JSON-compatible values')
  }

  const normalized: Record<string, CanonicalJson> = {}
  for (const key of Object.keys(value).sort()) {
    const entry = Reflect.get(value, key)
    if (entry === undefined) {
      throw new TypeError('Canonical JSON does not accept undefined values')
    }
    normalized[key] = normalizeJson(entry)
  }
  return normalized
}

export const canonicalize = (value: unknown): string =>
  JSON.stringify(normalizeJson(value))

export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

export const requestHash = (value: unknown): string =>
  sha256(canonicalize(value))

export const operationKey = (namespace: string, requestId: string): string => {
  const normalizedNamespace = namespace.trim()
  const normalizedRequestId = requestId.trim()
  if (normalizedNamespace.length === 0 || normalizedRequestId.length === 0) {
    throw new TypeError('Operation namespace and request id must be non-empty')
  }
  return `${normalizedNamespace}:${sha256(normalizedRequestId)}`
}
