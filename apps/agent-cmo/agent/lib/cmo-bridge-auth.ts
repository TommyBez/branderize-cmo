import { parseCmoAgentServerEnvironment } from '@repo/env/cmo-agent-server'
import {
  type AuthFn,
  extractBearerToken,
  UnauthenticatedError,
  verifyJwtHmac,
  withAuthChallenges,
} from 'eve/channels/auth'
import { z } from 'zod'

const BRIDGE_ISSUER = 'branderize-app'
const BRIDGE_AUDIENCE = 'agent-cmo'
const MAXIMUM_TOKEN_LIFETIME_SECONDS = 60
const MAXIMUM_TOKEN_LENGTH = 8192
const MINIMUM_SECRET_LENGTH = 32

interface CmoBridgeClaims {
  readonly audience: typeof BRIDGE_AUDIENCE
  readonly brandId: string
  readonly conversationId: string
  readonly expiresAt: number
  readonly issuedAt: number
  readonly issuer: typeof BRIDGE_ISSUER
  readonly jwtId: string
  readonly sourceTaskId: string | null
  readonly subject: string
}

const uuidSchema = z.uuid()

export interface CmoBridgeAuthDependencies {
  readonly nowSeconds: () => number
  readonly readSecret: () => string | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readNonEmptyString = (
  record: Readonly<Record<string, unknown>>,
  key: string
): string | null => {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    ? value
    : null
}

const readTimestamp = (
  record: Readonly<Record<string, unknown>>,
  key: string
): number | null => {
  const value = record[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

const decodePayload = (token: string): Record<string, unknown> | null => {
  if (token.length > MAXIMUM_TOKEN_LENGTH) {
    return null
  }

  const segments = token.split('.')
  if (segments.length !== 3) {
    return null
  }
  const [, payloadSegment] = segments
  if (payloadSegment === undefined || payloadSegment.length === 0) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payloadSegment, 'base64url').toString('utf8')
    )
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const parseClaims = ({
  nowSeconds,
  token,
}: {
  readonly nowSeconds: number
  readonly token: string
}): CmoBridgeClaims | null => {
  const payload = decodePayload(token)
  if (payload === null || 'role' in payload) {
    return null
  }

  const audience = readNonEmptyString(payload, 'aud')
  const brandId = readNonEmptyString(payload, 'brand_id')
  const conversationId = readNonEmptyString(payload, 'conversation_id')
  const expiresAt = readTimestamp(payload, 'exp')
  const issuedAt = readTimestamp(payload, 'iat')
  const issuer = readNonEmptyString(payload, 'iss')
  const jwtId = readNonEmptyString(payload, 'jti')
  const sourceTaskId = readNonEmptyString(payload, 'source_task_id')
  const subject = readNonEmptyString(payload, 'sub')

  if (
    audience !== BRIDGE_AUDIENCE ||
    brandId === null ||
    conversationId === null ||
    expiresAt === null ||
    issuedAt === null ||
    issuer !== BRIDGE_ISSUER ||
    jwtId === null ||
    ('source_task_id' in payload &&
      (sourceTaskId === null || !uuidSchema.safeParse(sourceTaskId).success)) ||
    subject === null ||
    issuedAt > nowSeconds ||
    expiresAt <= nowSeconds ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAXIMUM_TOKEN_LIFETIME_SECONDS
  ) {
    return null
  }

  return {
    audience,
    brandId,
    conversationId,
    expiresAt,
    issuedAt,
    issuer,
    jwtId,
    sourceTaskId,
    subject,
  }
}

const safelyReadSecret = (
  readSecret: CmoBridgeAuthDependencies['readSecret']
): string | undefined => {
  try {
    return readSecret()
  } catch {
    // Invalid runtime configuration is mapped to configuration_error below.
  }
}

export const createCmoBridgeAuth = ({
  nowSeconds,
  readSecret,
}: CmoBridgeAuthDependencies): AuthFn<Request> =>
  withAuthChallenges(
    async (request) => {
      const token = extractBearerToken(request.headers.get('authorization'))
      if (token === null) {
        return null
      }

      const secret = safelyReadSecret(readSecret)

      if (secret === undefined || secret.length < MINIMUM_SECRET_LENGTH) {
        throw new UnauthenticatedError({
          code: 'configuration_error',
          message: 'CMO bridge authentication is not configured.',
        })
      }

      const currentTime = nowSeconds()
      if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
        throw new UnauthenticatedError({
          code: 'configuration_error',
          message: 'CMO bridge authentication is not configured.',
        })
      }

      const claims = parseClaims({ nowSeconds: currentTime, token })
      if (claims === null) {
        return null
      }

      const verification = await verifyJwtHmac(token, {
        algorithm: 'HS256',
        audiences: [BRIDGE_AUDIENCE],
        claims: {
          brand_id: [claims.brandId],
          conversation_id: [claims.conversationId],
          jti: [claims.jwtId],
          ...(claims.sourceTaskId === null
            ? {}
            : { source_task_id: [claims.sourceTaskId] }),
        },
        clockSkewSeconds: 0,
        issuer: BRIDGE_ISSUER,
        secret,
        subjects: [claims.subject],
      })
      if (
        !verification.ok ||
        verification.sessionAuth.subject !== claims.subject
      ) {
        return null
      }

      return {
        attributes: {
          brand_id: claims.brandId,
          conversation_id: claims.conversationId,
          ...(claims.sourceTaskId === null
            ? {}
            : { source_task_id: claims.sourceTaskId }),
        },
        authenticator: 'cmo-bridge',
        issuer: claims.issuer,
        principalId: claims.subject,
        principalType: 'user',
        subject: claims.subject,
      }
    },
    [{ scheme: 'Bearer' }]
  )

export const cmoBridgeAuth = createCmoBridgeAuth({
  nowSeconds: () => Math.floor(Date.now() / 1000),
  readSecret: () =>
    parseCmoAgentServerEnvironment(process.env).CMO_BRIDGE_SECRET,
})
