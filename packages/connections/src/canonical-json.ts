import { createHash } from 'node:crypto'
import { z } from 'zod'

type JsonValue = z.infer<ReturnType<typeof z.json>>

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

const encodePrimitive = (value: null | boolean | number | string): string => {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) {
    throw new Error('JSON primitive could not be encoded')
  }
  return encoded
}

const encodeJson = (value: JsonValue): string => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return encodePrimitive(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(encodeJson).join(',')}]`
  }

  const fields = Object.entries(value)
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(
      ([key, entryValue]) => `${encodePrimitive(key)}:${encodeJson(entryValue)}`
    )
  return `{${fields.join(',')}}`
}

export const canonicalJson = (value: unknown): string =>
  encodeJson(z.json().parse(value))

export const sha256CanonicalJson = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex')
