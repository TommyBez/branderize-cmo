import { requestHash } from '@repo/brain/canonical'
import {
  type CmoSessionIdentity as CmoSessionIdentityValue,
  resolveTrustedCmoTurnAccess as resolveBrainCmoTurnAccess,
  resolveInitialCmoSessionAccess,
  type TrustedCmoSessionMemberAccess,
} from '@repo/brain/cmo-access'
import {
  type ActiveIntentTarget as ActiveIntentTargetValue,
  loadCmoIntentTarget as loadBrainCmoIntentTarget,
  loadCmoRefineIntentTarget as loadBrainCmoRefineIntentTarget,
} from '@repo/brain/cmo-intent-target'
import type { TrustedCmoTurnAccess } from '@repo/brain/context'
import { getProductMarketerQuestionTaskIdForResolution } from '@repo/brain/task-projections'
import type { Database } from '@repo/db/client'
import type { SessionAuthContext } from 'eve/context'
import type { HookContext } from 'eve/hooks'
import type { ToolContext } from 'eve/tools'
import { z } from 'zod'

const CMO_AUTHENTICATOR = 'cmo-bridge'
const uuidSchema = z.uuid()

const readScalarAttribute = (auth: SessionAuthContext, key: string): string => {
  const value = auth.attributes[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Trusted CMO attribute ${key} is missing`)
  }
  return value
}

const identityFromAuth = (
  auth: SessionAuthContext
): CmoSessionIdentityValue => {
  const brandId = readScalarAttribute(auth, 'brand_id')
  const conversationId = readScalarAttribute(auth, 'conversation_id')
  if (
    auth.authenticator !== CMO_AUTHENTICATOR ||
    auth.principalType !== 'user' ||
    auth.principalId.length === 0 ||
    (auth.subject !== undefined && auth.subject !== auth.principalId)
  ) {
    throw new Error('CMO session authority is invalid')
  }
  return { brandId, conversationId, userId: auth.principalId }
}

const identitiesMatch = (
  left: CmoSessionIdentityValue,
  right: CmoSessionIdentityValue
): boolean =>
  left.brandId === right.brandId &&
  left.conversationId === right.conversationId &&
  left.userId === right.userId

export const readCmoSessionIdentity = (
  context: Pick<HookContext, 'session'> | Pick<ToolContext, 'session'>
): CmoSessionIdentityValue => {
  const { current, initiator } = context.session.auth
  if (initiator === null) {
    throw new Error('CMO initiating authentication is missing')
  }
  if (current === null) {
    throw new Error('CMO current authentication is missing')
  }
  const initiatingIdentity = identityFromAuth(initiator)
  const currentIdentity = identityFromAuth(current)
  if (!identitiesMatch(currentIdentity, initiatingIdentity)) {
    throw new Error('CMO session authority changed')
  }
  return currentIdentity
}

export const readCurrentCmoSourceTaskId = (
  context: Pick<ToolContext, 'session'>
): string => {
  if (context.session.parent !== undefined) {
    throw new Error('CMO canonical tools are root-only')
  }
  readCmoSessionIdentity(context)
  const { current } = context.session.auth
  if (current === null) {
    throw new Error('CMO current authentication is missing')
  }
  const parsed = uuidSchema.safeParse(current.attributes.source_task_id)
  if (!parsed.success) {
    throw new Error('The current CMO turn has no trusted source task')
  }
  return parsed.data
}

export const resolveInitialCmoSessionMemberAccess = async ({
  context,
  database,
}: {
  readonly context: Pick<HookContext, 'session'>
  readonly database: Database
}): Promise<TrustedCmoSessionMemberAccess> =>
  await resolveInitialCmoSessionAccess({
    database,
    identity: {
      ...readCmoSessionIdentity(context),
      sessionId: context.session.id,
    },
  })

export const resolveTrustedCmoTurnAccess = async ({
  context,
  database,
}: {
  readonly context: ToolContext
  readonly database: Database
}): Promise<TrustedCmoTurnAccess> => {
  if (context.session.parent !== undefined) {
    throw new Error('CMO canonical tools are root-only')
  }
  return await resolveBrainCmoTurnAccess({
    database,
    identity: {
      ...readCmoSessionIdentity(context),
      callId: context.callId,
      sessionId: context.session.id,
      turnId: context.session.turn.id,
    },
  })
}

export const stableCmoRequestId = ({
  context,
  operation,
  semantics,
}: {
  readonly context: Pick<ToolContext, 'session'>
  readonly operation: string
  readonly semantics: unknown
}): string => {
  const identity = readCmoSessionIdentity(context)
  return `eve:${operation}:${requestHash({
    brandId: identity.brandId,
    conversationId: identity.conversationId,
    operation,
    semantics,
    sessionId: context.session.id,
    turnId: context.session.turn.id,
    userId: identity.userId,
  })}`
}

export const loadCmoIntentTarget = async ({
  access,
  database,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
}): Promise<ActiveIntentTargetValue> =>
  await loadBrainCmoIntentTarget({ access, database })

export const loadCmoRefineIntentTarget = async ({
  access,
  database,
  requestId,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
  readonly requestId: string
}): Promise<ActiveIntentTargetValue> =>
  await loadBrainCmoRefineIntentTarget({ access, database, requestId })

export const loadProductMarketerQuestionTaskId = async ({
  access,
  database,
  sourceTaskId,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
  readonly sourceTaskId: string
}): Promise<string> => {
  const taskId = await getProductMarketerQuestionTaskIdForResolution({
    access,
    database,
    sourceTaskId,
  })
  if (taskId === null) {
    throw new Error('The trusted source task has no open question bundle')
  }
  return taskId
}

export type { CmoSessionIdentity } from '@repo/brain/cmo-access'
export type { ActiveIntentTarget } from '@repo/brain/cmo-intent-target'
