import { createHash, timingSafeEqual } from 'node:crypto'

const MINIMUM_SECRET_LENGTH = 32
const BEARER_SCHEME = 'bearer'
const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
}

export interface DispatchSecretDependencies {
  readonly readSecret: () => string | undefined
}

export interface PayloadFreeDispatchHandlerDependencies<TContext>
  extends DispatchSecretDependencies {
  readonly onAccepted: (context: TContext) => void
}

const jsonError = (status: number, code: string): Response =>
  Response.json(
    { code, ok: false },
    {
      headers: NO_STORE_HEADERS,
      status,
    }
  )

const acceptedResponse = (): Response =>
  new Response(null, {
    headers: NO_STORE_HEADERS,
    status: 202,
  })

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

const rejectInvalidDispatchRequest = async ({
  readSecret,
  request,
}: DispatchSecretDependencies & {
  readonly request: Request
}): Promise<Response | null> => {
  const configuredSecret = readSecret()
  if (
    configuredSecret === undefined ||
    configuredSecret.length < MINIMUM_SECRET_LENGTH
  ) {
    return jsonError(503, 'dispatch_unavailable')
  }

  const providedSecret = parseBearerToken(request.headers.get('authorization'))
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

  return null
}

export const createPayloadFreeDispatchHandler =
  <TContext>({
    onAccepted,
    readSecret,
  }: PayloadFreeDispatchHandlerDependencies<TContext>) =>
  async (request: Request, context: TContext): Promise<Response> => {
    const rejection = await rejectInvalidDispatchRequest({
      readSecret,
      request,
    })
    if (rejection !== null) {
      return rejection
    }

    onAccepted(context)
    return acceptedResponse()
  }

export const createDispatchAckHandler = ({
  readSecret,
}: DispatchSecretDependencies): ((request: Request) => Promise<Response>) => {
  const handle = createPayloadFreeDispatchHandler<undefined>({
    onAccepted: () => undefined,
    readSecret,
  })
  return async (request: Request): Promise<Response> =>
    await handle(request, undefined)
}
