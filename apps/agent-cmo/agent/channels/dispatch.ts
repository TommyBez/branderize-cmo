import { createHash, timingSafeEqual } from 'node:crypto'

import { parseCmoAgentServerEnvironment } from '@repo/env/cmo-agent-server'
import { defineChannel, POST } from 'eve/channels'

import { ROOT_RUNTIME_CONTRACT } from '../lib/root-contract'

const MINIMUM_SECRET_LENGTH = 32
const BEARER_SCHEME = 'bearer'
const NO_STORE_HEADERS = { 'cache-control': 'no-store' } as const

export interface DispatchHandlerDependencies {
  readonly readSecret: () => string | undefined
}

const jsonError = (status: number, code: string): Response =>
  Response.json(
    { code, ok: false },
    {
      headers: NO_STORE_HEADERS,
      status,
    }
  )

const parseBearerToken = (authorization: string | null): string | null => {
  if (authorization === null) {
    return null
  }

  const separatorIndex = authorization.indexOf(' ')
  if (separatorIndex < 1) {
    return null
  }

  const scheme = authorization.slice(0, separatorIndex).toLowerCase()
  const token = authorization.slice(separatorIndex + 1)
  if (
    scheme !== BEARER_SCHEME ||
    token.length === 0 ||
    token.trim() !== token ||
    token.includes(' ')
  ) {
    return null
  }

  return token
}

const secretsMatch = (provided: string, configured: string): boolean => {
  const providedDigest = createHash('sha256').update(provided).digest()
  const configuredDigest = createHash('sha256').update(configured).digest()
  return timingSafeEqual(providedDigest, configuredDigest)
}

export const createDispatchHandler =
  ({
    readSecret,
  }: DispatchHandlerDependencies): ((request: Request) => Promise<Response>) =>
  async (request: Request): Promise<Response> => {
    const configuredSecret = readSecret()
    if (
      configuredSecret === undefined ||
      configuredSecret.length < MINIMUM_SECRET_LENGTH
    ) {
      return jsonError(503, 'dispatch_unavailable')
    }

    const providedSecret = parseBearerToken(
      request.headers.get('authorization')
    )
    if (
      providedSecret === null ||
      !secretsMatch(providedSecret, configuredSecret)
    ) {
      const response = jsonError(401, 'unauthorized')
      response.headers.set('www-authenticate', 'Bearer')
      return response
    }

    if (new URL(request.url).search.length > 0) {
      return jsonError(400, 'selectors_not_allowed')
    }

    if ((await request.arrayBuffer()).byteLength > 0) {
      return jsonError(400, 'payload_not_allowed')
    }

    return new Response(null, {
      headers: NO_STORE_HEADERS,
      status: 202,
    })
  }

export const handleDispatchRequest = createDispatchHandler({
  readSecret: () => {
    try {
      return parseCmoAgentServerEnvironment(process.env).DISPATCH_SECRET
    } catch {
      // Invalid runtime configuration keeps dispatch closed.
    }
  },
})

export default defineChannel({
  routes: [
    POST(ROOT_RUNTIME_CONTRACT.dispatch.path, async (request) =>
      handleDispatchRequest(request)
    ),
  ],
})
