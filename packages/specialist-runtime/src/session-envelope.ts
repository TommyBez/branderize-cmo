import { getAgent } from '@repo/agents'
import type { ClaimedTask } from '@repo/brain/tasks'
import type { SessionAuthContext } from 'eve/context'
import { z } from 'zod'

const AGENT_PRINCIPAL_TYPE = 'agent'
const ISSUER = 'branderize-agent-server'
const taskAddressIdentitySchema = z
  .object({ startedAt: z.date(), taskId: z.uuid() })
  .strict()

export const authenticatorOf = (
  workerKey: ClaimedTask['workerKey']
): `${ClaimedTask['workerKey']}-dispatch` => `${workerKey}-dispatch`

export const taskAddressOf = (
  claim: Pick<ClaimedTask, 'startedAt' | 'taskId'>
): string => {
  const identity = taskAddressIdentitySchema.parse({
    startedAt: claim.startedAt,
    taskId: claim.taskId,
  })
  return `task:${identity.taskId}:${identity.startedAt.toISOString()}`
}

export const createTaskSessionAuth = (
  claim: ClaimedTask
): SessionAuthContext => {
  const registeredAgent = getAgent(claim.workerKey)
  return {
    attributes: {
      agent_actor_id: claim.agentActorId,
      agent_actor_key: claim.agentActorKey,
      brand_id: claim.brandId,
      claim_context: JSON.stringify(claim.claimContext),
      task_id: claim.taskId,
      task_kind: claim.kind,
      task_started_at: claim.startedAt.toISOString(),
      worker_key: claim.workerKey,
    },
    authenticator: authenticatorOf(claim.workerKey),
    issuer: ISSUER,
    principalId: claim.agentActorId,
    principalType: AGENT_PRINCIPAL_TYPE,
    subject: registeredAgent.actorKey,
  }
}
