import type { TrustedMemberAccess } from '@repo/brain/context'
import {
  authorizeCmoSession,
  authorizeCmoSessionCreation,
  bindCmoSession,
} from '@repo/brain/conversations'
import { BrainError } from '@repo/brain/errors'
import { db } from '@repo/db'
import { z } from 'zod'

import {
  authorizeCmoSourceTaskClaim,
  createCmoClient,
  fetchCmoRuntime,
} from '@/lib/cmo'
import { AppAccessError, requireBrandRequestContext } from '@/lib/dal'

const MAXIMUM_BODY_BYTES = 24_000
const sessionIdSchema = z.string().trim().min(1).max(2048)
const messageBodySchema = z
  .object({ message: z.string().trim().min(1).max(20_000) })
  .strict()
const cancelBodySchema = z
  .object({ turnId: z.string().trim().min(1).max(2048) })
  .strict()

interface RouteContext {
  readonly params: Promise<{
    readonly brandId: string
    readonly conversationId: string
    readonly evePath: readonly string[]
  }>
}

type ProxyOperation =
  | { readonly kind: 'create' }
  | { readonly kind: 'message'; readonly sessionId: string }
  | { readonly kind: 'stream'; readonly sessionId: string }
  | { readonly kind: 'cancel'; readonly sessionId: string }

const parseOperation = (
  method: string,
  path: readonly string[]
): ProxyOperation | null => {
  if (
    method === 'POST' &&
    path.length === 3 &&
    path[0] === 'eve' &&
    path[1] === 'v1' &&
    path[2] === 'session'
  ) {
    return { kind: 'create' }
  }
  if (path[0] !== 'eve' || path[1] !== 'v1' || path[2] !== 'session') {
    return null
  }
  const sessionId = sessionIdSchema.safeParse(path[3])
  if (!sessionId.success) {
    return null
  }
  if (method === 'POST' && path.length === 4) {
    return { kind: 'message', sessionId: sessionId.data }
  }
  if (method === 'GET' && path.length === 5 && path[4] === 'stream') {
    return { kind: 'stream', sessionId: sessionId.data }
  }
  if (method === 'POST' && path.length === 5 && path[4] === 'cancel') {
    return { kind: 'cancel', sessionId: sessionId.data }
  }
  return null
}

const readJson = async (request: Request): Promise<unknown> => {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAXIMUM_BODY_BYTES
  ) {
    throw new AppAccessError('forbidden', 'Request body is too large')
  }
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > MAXIMUM_BODY_BYTES) {
    throw new AppAccessError('forbidden', 'Request body is too large')
  }
  return JSON.parse(body)
}

const readMessageBody = async (
  request: Request
): Promise<z.infer<typeof messageBodySchema>> =>
  messageBodySchema.parse(await readJson(request))

const validatedStreamSearch = (request: Request): string => {
  const source = new URL(request.url).searchParams
  for (const key of source.keys()) {
    if (key !== 'startIndex' && key !== 'includeTailIndex') {
      throw new AppAccessError('forbidden', 'Unsupported stream selector')
    }
  }
  const target = new URLSearchParams()
  const startIndex = source.get('startIndex')
  if (startIndex !== null) {
    const parsed = z.coerce.number().int().safeParse(startIndex)
    if (!parsed.success) {
      throw new AppAccessError('forbidden', 'Invalid stream cursor')
    }
    target.set('startIndex', String(parsed.data))
  }
  const includeTailIndex = source.get('includeTailIndex')
  if (includeTailIndex !== null) {
    if (includeTailIndex !== '1') {
      throw new AppAccessError('forbidden', 'Invalid stream tail selector')
    }
    target.set('includeTailIndex', includeTailIndex)
  }
  const serialized = target.toString()
  return serialized.length === 0 ? '' : `?${serialized}`
}

const responseHeaders = (upstream: Response): Headers => {
  const headers = new Headers({
    'cache-control': 'private, no-store, no-transform',
    'x-content-type-options': 'nosniff',
  })
  const allowlist = [
    'content-type',
    'x-eve-session-id',
    'x-eve-stream-format',
    'x-eve-stream-tail-index',
    'x-eve-stream-version',
  ] as const
  for (const name of allowlist) {
    const value = upstream.headers.get(name)
    if (value !== null) {
      headers.set(name, value)
    }
  }
  if (upstream.headers.get('x-accel-buffering') === 'no') {
    headers.set('x-accel-buffering', 'no')
  }
  return headers
}

const runtimeFailure = async (upstream: Response): Promise<Response> => {
  await upstream.body?.cancel()
  const status = upstream.status >= 500 ? 503 : upstream.status
  return Response.json(
    { error: 'CMO runtime rejected the operation', ok: false },
    { status }
  )
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const forwardedResponse = (upstream: Response): Response =>
  new Response(upstream.body, {
    headers: responseHeaders(upstream),
    status: upstream.status,
  })

const readSourceTaskId = async ({
  access,
  request,
}: {
  readonly access: TrustedMemberAccess
  readonly request: Request
}): Promise<string | undefined> => {
  const sourceTaskId = request.headers.get('x-branderize-source-task-id')
  return sourceTaskId === null
    ? undefined
    : await authorizeCmoSourceTaskClaim({ access, sourceTaskId })
}

interface OperationContext {
  readonly access: TrustedMemberAccess
  readonly brandId: string
  readonly conversationId: string
  readonly request: Request
}

const forwardCreate = async ({
  access,
  brandId,
  conversationId,
  request,
}: OperationContext): Promise<Response> => {
  await authorizeCmoSessionCreation({
    access,
    database: db,
    input: { conversationId },
  })
  const [body, sourceTaskId] = await Promise.all([
    readMessageBody(request),
    readSourceTaskId({ access, request }),
  ])
  const client = createCmoClient({
    brandId,
    conversationId,
    ...(sourceTaskId === undefined ? {} : { sourceTaskId }),
    userId: access.userId,
  })
  const upstream = await client.fetch('/eve/v1/session', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!upstream.ok) {
    return await runtimeFailure(upstream)
  }
  const payload: unknown = await upstream.clone().json()
  const responseSessionId = sessionIdSchema.parse(
    isRecord(payload) && typeof payload.sessionId === 'string'
      ? payload.sessionId
      : upstream.headers.get('x-eve-session-id')
  )
  await bindCmoSession({
    access,
    database: db,
    input: {
      conversationId,
      sessionId: responseSessionId,
      source: 'proxy-create-response',
    },
  })
  return forwardedResponse(upstream)
}

const forwardMessage = async ({
  access,
  brandId,
  conversationId,
  operation,
  request,
}: OperationContext & {
  readonly operation: Extract<ProxyOperation, { readonly kind: 'message' }>
}): Promise<Response> => {
  await authorizeCmoSession({
    access,
    database: db,
    input: {
      conversationId,
      operation: { kind: 'write', name: 'message' },
      sessionId: operation.sessionId,
    },
  })
  const [body, sourceTaskId] = await Promise.all([
    readMessageBody(request),
    readSourceTaskId({ access, request }),
  ])
  const client = createCmoClient({
    brandId,
    conversationId,
    ...(sourceTaskId === undefined ? {} : { sourceTaskId }),
    userId: access.userId,
  })
  const upstream = await client.fetch(
    `/eve/v1/session/${encodeURIComponent(operation.sessionId)}`,
    {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  )
  return upstream.ok
    ? forwardedResponse(upstream)
    : await runtimeFailure(upstream)
}

const forwardStream = async ({
  access,
  brandId,
  conversationId,
  operation,
  request,
}: OperationContext & {
  readonly operation: Extract<ProxyOperation, { readonly kind: 'stream' }>
}): Promise<Response> => {
  await authorizeCmoSession({
    access,
    database: db,
    input: {
      conversationId,
      operation: { kind: 'read', name: 'stream' },
      sessionId: operation.sessionId,
    },
  })
  const search = validatedStreamSearch(request)
  const upstream = await fetchCmoRuntime({
    brandId,
    conversationId,
    init: {
      cache: 'no-store',
      method: 'GET',
      signal: request.signal,
    },
    path: `/eve/v1/session/${encodeURIComponent(operation.sessionId)}/stream${search}`,
    userId: access.userId,
  })
  return upstream.ok
    ? forwardedResponse(upstream)
    : await runtimeFailure(upstream)
}

const forwardCancel = async ({
  access,
  brandId,
  conversationId,
  operation,
  request,
}: OperationContext & {
  readonly operation: Extract<ProxyOperation, { readonly kind: 'cancel' }>
}): Promise<Response> => {
  const body = cancelBodySchema.parse(await readJson(request))
  await authorizeCmoSession({
    access,
    database: db,
    input: {
      conversationId,
      operation: {
        kind: 'cancel',
        turnId: body.turnId,
      },
      sessionId: operation.sessionId,
    },
  })
  const client = createCmoClient({
    brandId,
    conversationId,
    userId: access.userId,
  })
  const upstream = await client.fetch(
    `/eve/v1/session/${encodeURIComponent(operation.sessionId)}/cancel`,
    {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  )
  return upstream.ok
    ? forwardedResponse(upstream)
    : await runtimeFailure(upstream)
}

const dispatchOperation = async ({
  access,
  brandId,
  conversationId,
  operation,
  request,
}: OperationContext & {
  readonly operation: ProxyOperation
}): Promise<Response> => {
  switch (operation.kind) {
    case 'create':
      return await forwardCreate({ access, brandId, conversationId, request })
    case 'message':
      return await forwardMessage({
        access,
        brandId,
        conversationId,
        operation,
        request,
      })
    case 'stream':
      return await forwardStream({
        access,
        brandId,
        conversationId,
        operation,
        request,
      })
    case 'cancel':
      return await forwardCancel({
        access,
        brandId,
        conversationId,
        operation,
        request,
      })
    default:
      return new Response(null, { status: 404 })
  }
}

const brainErrorStatus = (error: BrainError): number => {
  if (error.code === 'conversation_not_found') {
    return 404
  }
  if (error.code === 'access_denied') {
    return 403
  }
  return error.code === 'completion_conflict' ? 409 : 503
}

const errorResponse = (error: unknown): Response => {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json(
      { error: 'Invalid request', ok: false },
      { status: 400 }
    )
  }
  if (error instanceof AppAccessError) {
    const status = error.code === 'unauthenticated' ? 401 : 403
    return Response.json({ error: 'Access denied', ok: false }, { status })
  }
  if (error instanceof BrainError) {
    return Response.json(
      { error: 'CMO operation unavailable', ok: false },
      { status: brainErrorStatus(error) }
    )
  }
  return Response.json(
    { error: 'CMO proxy unavailable', ok: false },
    { status: 503 }
  )
}

const proxyRequest = async (
  request: Request,
  context: RouteContext
): Promise<Response> => {
  try {
    const { brandId, conversationId, evePath } = await context.params
    const operation = parseOperation(request.method, evePath)
    if (operation === null) {
      return new Response(null, { status: 404 })
    }
    const { access } = await requireBrandRequestContext(brandId)
    return await dispatchOperation({
      access,
      brandId,
      conversationId,
      operation,
      request,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export const GET = proxyRequest
export const POST = proxyRequest
