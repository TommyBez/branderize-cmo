import {
  AGENT_KEYS,
  type AgentKey,
  type ClaimContextOf,
  getAgent,
  getTaskKind,
  type RegisteredTaskKindKey,
  registeredTaskKindKeySchema,
} from '@repo/agents'
import type { TrustedTaskExecution } from '@repo/brain/context'
import { sha256CanonicalJson } from '@repo/canonical-json'
import type { SessionAuthContext } from 'eve/context'
import type { HookContext } from 'eve/hooks'
import type { ToolContext } from 'eve/tools'
import { z } from 'zod'

import { authenticatorOf } from './session-envelope'

const AGENT_PRINCIPAL_TYPE = 'agent'
const agentKeySchema = z.enum(AGENT_KEYS)
const taskStartedAtAttributeSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))

export type TaskSessionLineage =
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

export interface TaskSession<
  TKind extends RegisteredTaskKindKey = RegisteredTaskKindKey,
> {
  readonly agentActorId: string
  readonly agentActorKey: `agent:${AgentKey}`
  readonly brandId: string
  readonly claimContext: ClaimContextOf<TKind>
  readonly kind: TKind
  readonly rootSessionId: string
  readonly sessionId: string
  readonly startedAt: Date
  readonly taskId: string
  readonly workerKey: AgentKey
}

type SessionBearingContext =
  | Pick<HookContext, 'session'>
  | Pick<ToolContext, 'session'>

const readScalarAttribute = (auth: SessionAuthContext, key: string): string => {
  const value = auth.attributes[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Trusted task attribute ${key} is missing`)
  }
  return value
}

const readAuthenticatedIdentity = (
  auth: SessionAuthContext
): Omit<TaskSession, 'rootSessionId' | 'sessionId'> => {
  const agentActorId = readScalarAttribute(auth, 'agent_actor_id')
  const agentActorKey = readScalarAttribute(auth, 'agent_actor_key')
  const brandId = readScalarAttribute(auth, 'brand_id')
  const kind = registeredTaskKindKeySchema.parse(
    readScalarAttribute(auth, 'task_kind')
  )
  const taskId = readScalarAttribute(auth, 'task_id')
  const startedAt = taskStartedAtAttributeSchema.parse(
    readScalarAttribute(auth, 'task_started_at')
  )
  const workerKey = agentKeySchema.parse(
    readScalarAttribute(auth, 'worker_key')
  )
  const registeredAgent = getAgent(workerKey)
  const taskKind = getTaskKind(kind)
  if (
    auth.authenticator !== authenticatorOf(workerKey) ||
    auth.principalId !== agentActorId ||
    auth.principalType !== AGENT_PRINCIPAL_TYPE ||
    auth.subject !== registeredAgent.actorKey ||
    agentActorKey !== registeredAgent.actorKey ||
    taskKind.workerKey !== workerKey
  ) {
    throw new Error('Task session authority is invalid')
  }
  return {
    agentActorId,
    agentActorKey: registeredAgent.actorKey,
    brandId,
    claimContext: taskKind.claimContextSchema.parse(
      JSON.parse(readScalarAttribute(auth, 'claim_context')) as unknown
    ),
    kind,
    startedAt,
    taskId,
    workerKey,
  }
}

const identitiesMatch = (
  left: Omit<TaskSession, 'rootSessionId' | 'sessionId'>,
  right: Omit<TaskSession, 'rootSessionId' | 'sessionId'>
): boolean =>
  left.agentActorId === right.agentActorId &&
  left.agentActorKey === right.agentActorKey &&
  left.brandId === right.brandId &&
  left.kind === right.kind &&
  left.startedAt.getTime() === right.startedAt.getTime() &&
  left.taskId === right.taskId &&
  left.workerKey === right.workerKey &&
  JSON.stringify(left.claimContext) === JSON.stringify(right.claimContext)

export const taskSessionLineageFromContext = (
  context: SessionBearingContext
): TaskSessionLineage => {
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

export const readTaskSession = (
  context: SessionBearingContext
): TaskSession => {
  const { current, initiator } = context.session.auth
  if (current === null || initiator === null) {
    throw new Error('Task session authentication is missing')
  }
  const currentIdentity = readAuthenticatedIdentity(current)
  const initiatingIdentity = readAuthenticatedIdentity(initiator)
  if (!identitiesMatch(currentIdentity, initiatingIdentity)) {
    throw new Error('Task session authority changed')
  }
  const lineage = taskSessionLineageFromContext(context)
  return {
    ...currentIdentity,
    rootSessionId:
      lineage.kind === 'root' ? lineage.sessionId : lineage.rootSessionId,
    sessionId: context.session.id,
  }
}

export const requireRootTaskSession = (
  context: SessionBearingContext
): void => {
  if (context.session.parent !== undefined) {
    throw new Error('FINISH_TASK_ROOT_ONLY')
  }
}

export const taskExecutionOf = (
  context: SessionBearingContext
): TrustedTaskExecution => {
  const session = readTaskSession(context)
  return {
    agentActorId: session.agentActorId,
    agentActorKey: session.agentActorKey,
    brandId: session.brandId,
    rootSessionId: session.rootSessionId,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    taskId: session.taskId,
    workerKey: session.workerKey,
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
  const session = readTaskSession(context)
  return `eve:${operation}:${sha256CanonicalJson({
    brandId: session.brandId,
    operation,
    semantics,
    sessionId: session.sessionId,
    startedAt: session.startedAt.toISOString(),
    taskId: session.taskId,
    turnId: context.session.turn.id,
  })}`
}
