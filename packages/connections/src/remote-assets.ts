import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import type { IncomingMessage } from 'node:http'
import { request as requestHttps } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { z } from 'zod'

import {
  type BinaryContentType,
  type BrandId,
  binaryContentTypeExtensions,
  binaryContentTypeSchema,
  brandIdSchema,
  type CanonicalAsset,
  canonicalAssetSchema,
  type MirroredAsset,
  mirroredAssetSchema,
  sha256HexSchema,
} from './domain'
import type { CanonicalBlobStore } from './private-blob'

const remoteAssetPolicySchema = z
  .object({
    maxBytes: z.number().int().positive().max(100_000_000),
    maxRedirects: z.number().int().min(0).max(10),
    timeoutMs: z.number().int().min(250).max(120_000),
  })
  .strict()

const CONTENT_LENGTH_PATTERN = /^\d+$/
const SVG_DOCUMENT_PATTERN = /^(?:\uFEFF)?\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i

const sourceUrlSchema = z
  .url()
  .transform((value) => new URL(value))
  .superRefine((url, context) => {
    if (url.protocol !== 'https:') {
      context.addIssue({ code: 'custom', message: 'HTTPS is required' })
    }
    if (url.username !== '' || url.password !== '') {
      context.addIssue({ code: 'custom', message: 'Credentials are forbidden' })
    }
    if (url.port !== '' && url.port !== '443') {
      context.addIssue({ code: 'custom', message: 'Only port 443 is allowed' })
    }
  })

const parseSourceUrl = (value: string): URL => {
  const parsed = sourceUrlSchema.safeParse(value)
  if (!parsed.success) {
    throw new RemoteAssetError('Remote asset URL is not allowed', {
      code: 'unsafe_url',
    })
  }
  return parsed.data
}

const blockedAddresses = new BlockList()

const addBlockedSubnet = (
  network: string,
  prefix: number,
  family: 'ipv4' | 'ipv6'
): void => {
  blockedAddresses.addSubnet(network, prefix, family)
}

addBlockedSubnet('0.0.0.0', 8, 'ipv4')
addBlockedSubnet('10.0.0.0', 8, 'ipv4')
addBlockedSubnet('100.64.0.0', 10, 'ipv4')
addBlockedSubnet('127.0.0.0', 8, 'ipv4')
addBlockedSubnet('169.254.0.0', 16, 'ipv4')
addBlockedSubnet('172.16.0.0', 12, 'ipv4')
addBlockedSubnet('192.0.0.0', 24, 'ipv4')
addBlockedSubnet('192.0.2.0', 24, 'ipv4')
addBlockedSubnet('192.168.0.0', 16, 'ipv4')
addBlockedSubnet('198.18.0.0', 15, 'ipv4')
addBlockedSubnet('198.51.100.0', 24, 'ipv4')
addBlockedSubnet('203.0.113.0', 24, 'ipv4')
addBlockedSubnet('224.0.0.0', 4, 'ipv4')
addBlockedSubnet('240.0.0.0', 4, 'ipv4')
addBlockedSubnet('::', 128, 'ipv6')
addBlockedSubnet('::1', 128, 'ipv6')
addBlockedSubnet('100::', 64, 'ipv6')
addBlockedSubnet('2001:db8::', 32, 'ipv6')
addBlockedSubnet('fc00::', 7, 'ipv6')
addBlockedSubnet('fe80::', 10, 'ipv6')
addBlockedSubnet('ff00::', 8, 'ipv6')

export type RemoteAssetErrorCode =
  | 'content_too_large'
  | 'invalid_content'
  | 'invalid_content_type'
  | 'network_error'
  | 'redirect_limit'
  | 'remote_status'
  | 'timeout'
  | 'unsafe_url'

export interface RemoteAssetErrorOptions extends ErrorOptions {
  readonly code: RemoteAssetErrorCode
}

export class RemoteAssetError extends Error {
  readonly code: RemoteAssetErrorCode

  constructor(message: string, options: RemoteAssetErrorOptions) {
    super(message, options)
    this.name = 'RemoteAssetError'
    this.code = options.code
  }
}

export interface ValidatedRemoteAsset {
  readonly bytes: Uint8Array
  readonly contentType: BinaryContentType
  readonly finalUrl: string
  readonly sourceUrl: string
}

export interface RemoteAssetFetcher {
  readonly download: (sourceUrl: string) => Promise<ValidatedRemoteAsset>
}

export type HostnameResolver = (hostname: string) => Promise<readonly string[]>

type IpFamily = 4 | 6

export interface PinnedRemoteAssetRequest {
  readonly address: string
  readonly family: IpFamily
  readonly signal: AbortSignal
  readonly url: URL
}

export type RemoteAssetTransport = (
  request: PinnedRemoteAssetRequest
) => Promise<Response>

export interface RemoteAssetFetcherDependencies {
  readonly resolveHostname?: HostnameResolver
  readonly transport?: RemoteAssetTransport
}

const defaultHostnameResolver: HostnameResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  return addresses.map(({ address }) => address)
}

const normalizedHostname = (url: URL): string =>
  url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname

interface PublicAddress {
  readonly address: string
  readonly family: IpFamily
}

const assertPublicAddress = (address: string): PublicAddress => {
  const ipVersion = isIP(address)
  if (ipVersion === 0) {
    throw new RemoteAssetError('Resolver returned an invalid IP', {
      code: 'unsafe_url',
    })
  }

  const normalizedAddress =
    ipVersion === 6
      ? normalizedHostname(new URL(`https://[${address}]/`)).toLowerCase()
      : address
  if (normalizedAddress.startsWith('::ffff:')) {
    throw new RemoteAssetError('IPv4-mapped IPv6 addresses are forbidden', {
      code: 'unsafe_url',
    })
  }

  const family = ipVersion === 4 ? 'ipv4' : 'ipv6'
  if (blockedAddresses.check(address, family)) {
    throw new RemoteAssetError('Remote hostname resolves to a non-public IP', {
      code: 'unsafe_url',
    })
  }

  const pinnedFamily: IpFamily = ipVersion === 4 ? 4 : 6
  return { address, family: pinnedFamily }
}

const resolvePublicAddress = async (
  url: URL,
  resolveHostname: HostnameResolver
): Promise<PublicAddress> => {
  const hostname = normalizedHostname(url).toLowerCase()
  const blockedHostname =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  if (blockedHostname) {
    throw new RemoteAssetError('Local hostnames are forbidden', {
      code: 'unsafe_url',
    })
  }

  const literalIpVersion = isIP(hostname)
  if (literalIpVersion !== 0) {
    return assertPublicAddress(hostname)
  }

  let addresses: readonly string[]
  try {
    addresses = await resolveHostname(hostname)
  } catch (error) {
    throw new RemoteAssetError('Remote hostname did not resolve', {
      cause: error,
      code: 'unsafe_url',
    })
  }

  if (addresses.length === 0) {
    throw new RemoteAssetError('Remote hostname did not resolve', {
      code: 'unsafe_url',
    })
  }

  let selectedAddress: PublicAddress | undefined
  for (const address of addresses) {
    const publicAddress = assertPublicAddress(address)
    selectedAddress ??= publicAddress
  }

  if (selectedAddress === undefined) {
    throw new RemoteAssetError('Remote hostname did not resolve', {
      code: 'unsafe_url',
    })
  }
  return selectedAddress
}

const createPinnedLookup =
  ({ address, family }: PublicAddress): LookupFunction =>
  (_hostname, options, callback): void => {
    if (options.all === true) {
      callback(null, [{ address, family }])
      return
    }
    callback(null, address, family)
  }

const responseHasNoBody = (status: number): boolean =>
  status === 101 || status === 204 || status === 205 || status === 304

const createResponseHeaders = (rawHeaders: readonly string[]): Headers => {
  const headers = new Headers()
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]
    const value = rawHeaders[index + 1]
    if (name !== undefined && value !== undefined) {
      headers.append(name, value)
    }
  }
  return headers
}

const createResponseBody = (
  incomingResponse: IncomingMessage
): ReadableStream<Uint8Array> => {
  const chunks = incomingResponse[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    cancel: async () => {
      incomingResponse.destroy()
      await chunks.return?.()
    },
    pull: async (controller) => {
      try {
        const chunk: IteratorResult<unknown> = await chunks.next()
        if (chunk.done) {
          controller.close()
          return
        }
        if (!(chunk.value instanceof Uint8Array)) {
          const invalidChunkError = new Error(
            'Remote response yielded a non-binary chunk'
          )
          incomingResponse.destroy(invalidChunkError)
          throw invalidChunkError
        }
        controller.enqueue(chunk.value)
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

const defaultRemoteAssetTransport: RemoteAssetTransport = async ({
  address,
  family,
  signal,
  url,
}) =>
  new Promise<Response>((resolve, reject) => {
    const request = requestHttps(
      url,
      {
        agent: false,
        family,
        lookup: createPinnedLookup({ address, family }),
        method: 'GET',
        signal,
      },
      (incomingResponse) => {
        const status = incomingResponse.statusCode
        if (status === undefined) {
          incomingResponse.destroy()
          reject(new Error('Remote response has no status code'))
          return
        }

        try {
          const body = responseHasNoBody(status)
            ? null
            : createResponseBody(incomingResponse)
          if (body === null) {
            incomingResponse.resume()
          }
          resolve(
            new Response(body, {
              headers: createResponseHeaders(incomingResponse.rawHeaders),
              status,
              statusText: incomingResponse.statusMessage,
            })
          )
        } catch (error) {
          incomingResponse.destroy()
          reject(error)
        }
      }
    )
    request.once('error', reject)
    request.end()
  })

const readBoundedBody = async (
  response: Response,
  maxBytes: number
): Promise<Uint8Array> => {
  const reader = response.body?.getReader()
  if (reader === undefined) {
    throw new RemoteAssetError('Remote response has no body', {
      code: 'invalid_content',
    })
  }

  const chunks: Uint8Array[] = []
  let byteLength = 0
  const readNextChunk = async (): Promise<void> => {
    const chunk = await reader.read()
    if (chunk.done) {
      return
    }

    byteLength += chunk.value.byteLength
    if (byteLength > maxBytes) {
      await reader.cancel()
      throw new RemoteAssetError('Remote asset exceeds the byte limit', {
        code: 'content_too_large',
      })
    }
    chunks.push(chunk.value)
    await readNextChunk()
  }
  await readNextChunk()

  if (byteLength === 0) {
    throw new RemoteAssetError('Remote asset is empty', {
      code: 'invalid_content',
    })
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const startsWithBytes = (
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0
): boolean => signature.every((value, index) => bytes[offset + index] === value)

const startsWithAscii = (
  bytes: Uint8Array,
  signature: string,
  offset = 0
): boolean =>
  startsWithBytes(
    bytes,
    [...signature].map((character) => character.charCodeAt(0)),
    offset
  )

const isSvg = (bytes: Uint8Array): boolean => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return SVG_DOCUMENT_PATTERN.test(text)
  } catch {
    return false
  }
}

const contentMatchesType = (
  bytes: Uint8Array,
  contentType: BinaryContentType
): boolean => {
  switch (contentType) {
    case 'application/pdf':
      return startsWithAscii(bytes, '%PDF-')
    case 'image/gif':
      return (
        startsWithAscii(bytes, 'GIF87a') || startsWithAscii(bytes, 'GIF89a')
      )
    case 'image/jpeg':
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff])
    case 'image/png':
      return startsWithBytes(
        bytes,
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      )
    case 'image/svg+xml':
      return isSvg(bytes)
    case 'image/webp':
      return startsWithAscii(bytes, 'RIFF') && startsWithAscii(bytes, 'WEBP', 8)
    case 'video/mp4':
      return startsWithAscii(bytes, 'ftyp', 4)
    default: {
      const exhaustiveContentType: never = contentType
      return exhaustiveContentType
    }
  }
}

const parseContentType = (response: Response): BinaryContentType => {
  const rawContentType = response.headers.get('content-type')
  const contentType = rawContentType?.split(';', 1)[0]?.trim().toLowerCase()
  const parsed = binaryContentTypeSchema.safeParse(contentType)
  if (!parsed.success) {
    throw new RemoteAssetError('Remote asset has an unsupported content type', {
      code: 'invalid_content_type',
    })
  }
  return parsed.data
}

const assertContentLength = (response: Response, maxBytes: number): void => {
  const contentLength = response.headers.get('content-length')
  if (contentLength === null) {
    return
  }

  if (!CONTENT_LENGTH_PATTERN.test(contentLength)) {
    throw new RemoteAssetError('Remote asset has an invalid content length', {
      code: 'invalid_content',
    })
  }

  if (Number(contentLength) > maxBytes) {
    throw new RemoteAssetError('Remote asset exceeds the byte limit', {
      code: 'content_too_large',
    })
  }
}

const isRedirectStatus = (status: number): boolean =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308

const fetchValidatedAsset = async ({
  currentUrl,
  maxBytes,
  maxRedirects,
  redirects,
  resolveHostname,
  signal,
  transport,
}: {
  readonly currentUrl: URL
  readonly maxBytes: number
  readonly maxRedirects: number
  readonly redirects: number
  readonly resolveHostname: HostnameResolver
  readonly signal: AbortSignal
  readonly transport: RemoteAssetTransport
}): Promise<{
  readonly bytes: Uint8Array
  readonly contentType: BinaryContentType
  readonly finalUrl: URL
}> => {
  const endpoint = await resolvePublicAddress(currentUrl, resolveHostname)
  const response = await transport({
    address: endpoint.address,
    family: endpoint.family,
    signal,
    url: currentUrl,
  })

  if (isRedirectStatus(response.status)) {
    await response.body?.cancel()
    if (redirects >= maxRedirects) {
      throw new RemoteAssetError('Remote asset exceeded the redirect limit', {
        code: 'redirect_limit',
      })
    }
    const location = response.headers.get('location')
    if (location === null) {
      throw new RemoteAssetError('Remote redirect has no location', {
        code: 'invalid_content',
      })
    }
    return fetchValidatedAsset({
      currentUrl: parseSourceUrl(new URL(location, currentUrl).toString()),
      maxBytes,
      maxRedirects,
      redirects: redirects + 1,
      resolveHostname,
      signal,
      transport,
    })
  }

  if (!response.ok) {
    await response.body?.cancel()
    throw new RemoteAssetError(
      `Remote asset returned HTTP ${response.status}`,
      { code: 'remote_status' }
    )
  }

  assertContentLength(response, maxBytes)
  const contentType = parseContentType(response)
  const bytes = await readBoundedBody(response, maxBytes)
  if (!contentMatchesType(bytes, contentType)) {
    throw new RemoteAssetError(
      'Remote asset bytes do not match its content type',
      { code: 'invalid_content' }
    )
  }

  return { bytes, contentType, finalUrl: currentUrl }
}

export const createRemoteAssetFetcher = (
  policyInput: z.input<typeof remoteAssetPolicySchema>,
  dependencies: RemoteAssetFetcherDependencies = {}
): RemoteAssetFetcher => {
  const policy = remoteAssetPolicySchema.parse(policyInput)
  const resolveHostname =
    dependencies.resolveHostname ?? defaultHostnameResolver
  const transport = dependencies.transport ?? defaultRemoteAssetTransport

  return {
    download: async (sourceUrl) => {
      const initialUrl = parseSourceUrl(sourceUrl)
      const controller = new AbortController()
      let timedOut = false
      let rejectDeadline: ((reason: Error) => void) | undefined
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject
      })
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
        rejectDeadline?.(new Error('Remote asset deadline elapsed'))
      }, policy.timeoutMs)

      try {
        const result = await Promise.race([
          fetchValidatedAsset({
            currentUrl: initialUrl,
            maxBytes: policy.maxBytes,
            maxRedirects: policy.maxRedirects,
            redirects: 0,
            resolveHostname,
            signal: controller.signal,
            transport,
          }),
          deadline,
        ])
        return {
          bytes: result.bytes,
          contentType: result.contentType,
          finalUrl: result.finalUrl.toString(),
          sourceUrl: initialUrl.toString(),
        }
      } catch (error) {
        if (error instanceof RemoteAssetError) {
          throw error
        }
        if (timedOut) {
          throw new RemoteAssetError('Remote asset download timed out', {
            cause: error,
            code: 'timeout',
          })
        }
        throw new RemoteAssetError('Remote asset download failed', {
          cause: error,
          code: 'network_error',
        })
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

const buildCanonicalAsset = ({
  brandId,
  contentType,
  bytes,
}: {
  readonly brandId: BrandId
  readonly bytes: Uint8Array
  readonly contentType: BinaryContentType
}): CanonicalAsset => {
  const sha256 = sha256HexSchema.parse(
    createHash('sha256').update(bytes).digest('hex')
  )
  const extension = binaryContentTypeExtensions[contentType]
  return canonicalAssetSchema.parse({
    blobKey: `brands/${brandId}/artifacts/sha256/${sha256}.${extension}`,
    byteSize: bytes.byteLength,
    contentType,
    sha256,
  })
}

export const mirrorRemoteAsset = async ({
  blobStore,
  brandId: brandIdInput,
  remoteAssets,
  sourceUrl,
}: {
  readonly blobStore: CanonicalBlobStore
  readonly brandId: string
  readonly remoteAssets: RemoteAssetFetcher
  readonly sourceUrl: string
}): Promise<MirroredAsset> => {
  const brandId = brandIdSchema.parse(brandIdInput)
  const downloaded = await remoteAssets.download(sourceUrl)
  const canonical = buildCanonicalAsset({
    brandId,
    bytes: downloaded.bytes,
    contentType: downloaded.contentType,
  })
  await blobStore.upload({ asset: canonical, bytes: downloaded.bytes })

  return mirroredAssetSchema.parse({
    canonical,
    provenance: {
      finalUrl: downloaded.finalUrl,
      sourceUrl: downloaded.sourceUrl,
    },
  })
}
