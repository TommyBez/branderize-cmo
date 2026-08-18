import { requestHash } from '@repo/brain/canonical'
import type { TrustedTaskExecution } from '@repo/brain/context'
import type { ClaimedProductMarketerTask } from '@repo/brain/tasks'
import type { SessionAuthContext } from 'eve/context'
import type { HookContext } from 'eve/hooks'
import type { ToolContext } from 'eve/tools'
import { z } from 'zod'

const AUTHENTICATOR = 'product-marketer-dispatch'
const AGENT_PRINCIPAL_TYPE = 'agent'
const AGENT_ACTOR_KEY = 'agent:product-marketer'
const taskStartedAtAttributeSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
const taskAddressIdentitySchema = z
  .object({ startedAt: z.date(), taskId: z.uuid() })
  .strict()

interface AuthenticatedProductMarketerIdentity {
  readonly agentActorId: string
  readonly agentActorKey: typeof AGENT_ACTOR_KEY
  readonly brandContextObjectId: string
  readonly brandId: string
  readonly startedAt: Date
  readonly taskId: string
  readonly workerKey: 'product-marketer'
}

interface ProductMarketerSessionIdentity
  extends AuthenticatedProductMarketerIdentity {
  readonly rootSessionId: string
  readonly sessionId: string
}

export type ProductMarketerSessionLineage =
  | {
      readonly kind: 'root'
      readonly sessionId: string
    }
  | {
      readonly kind: 'child'
      readonly parentCallId: string
      readonly parentSessionId: string
      readonly rootSessionId: string
      readonly sessionId: string
    }

const readScalarAttribute = (auth: SessionAuthContext, key: string): string => {
  const value = auth.attributes[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Trusted Product Marketer attribute ${key} is missing`)
  }
  return value
}

const readAuthenticatedIdentity = (
  auth: SessionAuthContext
): AuthenticatedProductMarketerIdentity => {
  const agentActorId = readScalarAttribute(auth, 'agent_actor_id')
  const agentActorKey = readScalarAttribute(auth, 'agent_actor_key')
  const brandContextObjectId = readScalarAttribute(
    auth,
    'brand_context_object_id'
  )
  const brandId = readScalarAttribute(auth, 'brand_id')
  const taskId = readScalarAttribute(auth, 'task_id')
  const startedAt = taskStartedAtAttributeSchema.parse(
    readScalarAttribute(auth, 'task_started_at')
  )
  const workerKey = readScalarAttribute(auth, 'worker_key')
  if (
    auth.authenticator !== AUTHENTICATOR ||
    auth.principalId !== agentActorId ||
    auth.principalType !== AGENT_PRINCIPAL_TYPE ||
    auth.subject !== AGENT_ACTOR_KEY ||
    agentActorKey !== AGENT_ACTOR_KEY ||
    workerKey !== 'product-marketer'
  ) {
    throw new Error('Product Marketer session authority is invalid')
  }
  return {
    agentActorId,
    agentActorKey,
    brandContextObjectId,
    brandId,
    startedAt,
    taskId,
    workerKey,
  }
}

const identitiesMatch = (
  left: AuthenticatedProductMarketerIdentity,
  right: AuthenticatedProductMarketerIdentity
): boolean =>
  left.agentActorId === right.agentActorId &&
  left.agentActorKey === right.agentActorKey &&
  left.brandContextObjectId === right.brandContextObjectId &&
  left.brandId === right.brandId &&
  left.startedAt.getTime() === right.startedAt.getTime() &&
  left.taskId === right.taskId &&
  left.workerKey === right.workerKey

export const productMarketerSessionLineageFromContext = (
  context: Pick<HookContext, 'session'> | Pick<ToolContext, 'session'>
): ProductMarketerSessionLineage => {
  const { parent } = context.session
  if (parent === undefined) {
    return { kind: 'root', sessionId: context.session.id }
  }
  return {
    kind: 'child',
    parentCallId: parent.callId,
    parentSessionId: parent.sessionId,
    rootSessionId: parent.rootSessionId,
    sessionId: context.session.id,
  }
}

export const readProductMarketerSessionIdentity = (
  context: Pick<HookContext, 'session'> | Pick<ToolContext, 'session'>
): ProductMarketerSessionIdentity => {
  const { current, initiator } = context.session.auth
  if (current === null || initiator === null) {
    throw new Error('Product Marketer session authentication is missing')
  }
  const currentIdentity = readAuthenticatedIdentity(current)
  const initiatingIdentity = readAuthenticatedIdentity(initiator)
  if (!identitiesMatch(currentIdentity, initiatingIdentity)) {
    throw new Error('Product Marketer session authority changed')
  }
  const lineage = productMarketerSessionLineageFromContext(context)
  return {
    ...currentIdentity,
    rootSessionId:
      lineage.kind === 'root' ? lineage.sessionId : lineage.rootSessionId,
    sessionId: context.session.id,
  }
}

export const requireProductMarketerRootSession = (
  context: Pick<HookContext, 'session'> | Pick<ToolContext, 'session'>
): void => {
  if (context.session.parent !== undefined) {
    throw new Error('FINISH_TASK_ROOT_ONLY')
  }
}

export const createProductMarketerSessionAuth = (
  claim: ClaimedProductMarketerTask
): SessionAuthContext => ({
  attributes: {
    agent_actor_id: claim.agentActorId,
    agent_actor_key: claim.agentActorKey,
    brand_context_object_id: claim.brandContextObjectId,
    brand_id: claim.brandId,
    task_id: claim.taskId,
    task_started_at: claim.startedAt.toISOString(),
    worker_key: claim.workerKey,
  },
  authenticator: AUTHENTICATOR,
  issuer: 'branderize-agent-server',
  principalId: claim.agentActorId,
  principalType: AGENT_PRINCIPAL_TYPE,
  subject: claim.agentActorKey,
})

export const productMarketerTaskAddress = (
  claim: Pick<ClaimedProductMarketerTask, 'startedAt' | 'taskId'>
): string => {
  const identity = taskAddressIdentitySchema.parse({
    startedAt: claim.startedAt,
    taskId: claim.taskId,
  })
  return `task:${identity.taskId}:${identity.startedAt.toISOString()}`
}

export const taskExecutionFromClaim = ({
  claim,
  sessionId,
}: {
  readonly claim: ClaimedProductMarketerTask
  readonly sessionId: string
}): TrustedTaskExecution => ({
  agentActorId: claim.agentActorId,
  agentActorKey: claim.agentActorKey,
  brandId: claim.brandId,
  rootSessionId: sessionId,
  sessionId,
  startedAt: claim.startedAt,
  taskId: claim.taskId,
  workerKey: claim.workerKey,
})

export const taskExecutionFromContext = (
  context: Pick<ToolContext, 'session'>
): TrustedTaskExecution => {
  const identity = readProductMarketerSessionIdentity(context)
  return {
    agentActorId: identity.agentActorId,
    agentActorKey: identity.agentActorKey,
    brandId: identity.brandId,
    rootSessionId: identity.rootSessionId,
    sessionId: identity.sessionId,
    startedAt: identity.startedAt,
    taskId: identity.taskId,
    workerKey: identity.workerKey,
  }
}

export const stableTaskRequestId = ({
  context,
  operation,
  semantics,
}: {
  readonly context: Pick<ToolContext, 'session'>
  readonly operation: string
  readonly semantics: unknown
}): string => {
  const identity = readProductMarketerSessionIdentity(context)
  return `eve:${operation}:${requestHash({
    brandId: identity.brandId,
    operation,
    semantics,
    sessionId: identity.sessionId,
    startedAt: identity.startedAt.toISOString(),
    taskId: identity.taskId,
    turnId: context.session.turn.id,
  })}`
}

export const buildProductMarketerPrompt = (
  claim: ClaimedProductMarketerTask
): string =>
  [
    'Execute the trusted Product Marketer Brand Context task below.',
    'Use only the supplied immutable Intent snapshot and current Brand Context.',
    'For completed work, call save_brand_context and then finish_task.',
    'For partial or blocked work, do not write an Object; call finish_task with up to three precise questions.',
    'Return the same registered completion shape after the trusted tool confirms it.',
    JSON.stringify({
      currentBrandContext: claim.brandContextContent,
      intentSnapshot: claim.intentSnapshot,
      payload: claim.payload,
      taskKind: claim.kind,
    }),
  ].join('\n\n')
