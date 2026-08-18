import { createHash } from 'node:crypto'

export type CanonicalJson =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalJson[]
  | Readonly<{ [key: string]: CanonicalJson }>

const normalizeJson = (value: unknown): CanonicalJson => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }

  if (Array.isArray(value)) {
    const normalized: CanonicalJson[] = []
    for (const entry of value) {
      normalized.push(normalizeJson(entry))
    }
    return normalized
  }

  if (typeof value !== 'object') {
    throw new TypeError('Canonical JSON accepts only JSON-compatible values')
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
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

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(normalizeJson(value))

export const sha256Hex = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

export const sha256CanonicalJson = (value: unknown): string =>
  sha256Hex(canonicalJson(value))
