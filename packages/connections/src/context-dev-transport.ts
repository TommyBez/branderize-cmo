import { z } from 'zod'

import type { ContextDevRequestContract } from './context-dev-contracts'

const API_ORIGIN = 'https://api.context.dev'
const BRAND_PATH = '/v1/brand/retrieve'
const CRAWL_PATH = '/v1/web/crawl'
const STYLEGUIDE_PATH = '/v1/web/styleguide'

export type ContextDevAdapterErrorCode =
  | 'invalid_input'
  | 'invalid_response'
  | 'network_error'
  | 'provider_error'
  | 'timeout'

export interface ContextDevAdapterErrorOptions extends ErrorOptions {
  readonly code: ContextDevAdapterErrorCode
  readonly statusCode?: number | null
}

export class ContextDevAdapterError extends Error {
  readonly code: ContextDevAdapterErrorCode
  readonly statusCode: number | null

  constructor(message: string, options: ContextDevAdapterErrorOptions) {
    super(message, options)
    this.name = 'ContextDevAdapterError'
    this.code = options.code
    this.statusCode = options.statusCode ?? null
  }
}

const requestJson = async ({
  apiKey,
  body,
  fetchTransport,
  method,
  path,
  signal,
}: {
  readonly apiKey: string
  readonly body?: unknown
  readonly fetchTransport: typeof globalThis.fetch
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly signal: AbortSignal
}): Promise<unknown> => {
  const response = await fetchTransport(`${API_ORIGIN}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    method,
    signal,
  })

  if (!response.ok) {
    await response.body?.cancel()
    throw new ContextDevAdapterError(
      `Context.dev returned HTTP ${response.status}`,
      { code: 'provider_error', statusCode: response.status }
    )
  }

  const contentType = response.headers.get('content-type')?.toLowerCase()
  if (contentType?.includes('application/json') !== true) {
    await response.body?.cancel()
    throw new ContextDevAdapterError(
      'Context.dev returned a non-JSON response',
      { code: 'invalid_response' }
    )
  }

  try {
    return await response.json()
  } catch (error) {
    throw new ContextDevAdapterError('Context.dev returned malformed JSON', {
      cause: error,
      code: 'invalid_response',
    })
  }
}

const styleguidePath = (
  request: ContextDevRequestContract['styleguide']
): string => {
  const parameters = new URLSearchParams({
    colorScheme: request.colorScheme,
    domain: request.domain,
    tags: request.tags.join(','),
    timeoutMS: String(request.timeoutMS),
  })
  parameters.sort()
  return `${STYLEGUIDE_PATH}?${parameters}`
}

export interface ContextDevProviderPayloads {
  readonly brand: unknown
  readonly crawl: unknown
  readonly styleguide: unknown
}

export const requestContextDevPayloads = async ({
  apiKey,
  fetchTransport,
  requestContract,
  signal,
}: {
  readonly apiKey: string
  readonly fetchTransport: typeof globalThis.fetch
  readonly requestContract: ContextDevRequestContract
  readonly signal: AbortSignal
}): Promise<ContextDevProviderPayloads> => {
  const [brand, styleguide, crawl] = await Promise.all([
    requestJson({
      apiKey,
      body: requestContract.brand,
      fetchTransport,
      method: 'POST',
      path: BRAND_PATH,
      signal,
    }),
    requestJson({
      apiKey,
      fetchTransport,
      method: 'GET',
      path: styleguidePath(requestContract.styleguide),
      signal,
    }),
    requestJson({
      apiKey,
      body: requestContract.crawl,
      fetchTransport,
      method: 'POST',
      path: CRAWL_PATH,
      signal,
    }),
  ])

  return { brand, crawl, styleguide }
}

export const throwContextDevImportError = (
  error: unknown,
  timedOut: boolean
): never => {
  if (timedOut) {
    throw new ContextDevAdapterError('Context.dev import timed out', {
      cause: error,
      code: 'timeout',
    })
  }
  if (error instanceof ContextDevAdapterError) {
    throw error
  }
  if (error instanceof z.ZodError) {
    throw new ContextDevAdapterError(
      'Context.dev response failed schema validation',
      { cause: error, code: 'invalid_response' }
    )
  }
  throw new ContextDevAdapterError('Context.dev import failed', {
    cause: error,
    code: 'network_error',
  })
}
