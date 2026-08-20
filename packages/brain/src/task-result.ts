// biome-ignore-all lint/performance/noAwaitInLoops: Stale rows settle one generation at a time so a CAS race cannot re-queue.
import { randomUUID } from 'node:crypto'

import {
  type AgentKey,
  getAgent,
  getTaskKind,
  type RegisteredTaskKindKey,
} from '@repo/agents'
import type { Database } from '@repo/db/client'
import { actions, actors, tasks } from '@repo/db/schema/domain'
import { and, eq, inArray, lte } from 'drizzle-orm'

import { fail } from './errors'
import { type BrainTransaction, requireTrustedAgentActor } from './internal'
import {
  type ClaimedHumanCommitment,
  HUMAN_COMMITMENT_STALE_AFTER_MS,
  humanCommitmentGenerationMatches,
} from './task-claim-human'
import {
  type CommitmentOutcome,
  commitmentOutcomeSchema,
  commitmentResultActionPayloadSchema,
} from './task-commitment-contracts'
import { taskGenerationOf } from './task-contracts'

export const STALE_HUMAN_COMMITMENT_CODE = 'stale_running' as const

export interface HumanCommitmentSettlement {
  readonly actionId: string
  readonly status: 'failed' | 'outcome_unknown' | 'succeeded'
  readonly taskId: string
}

const statusOf = (
  outcome: CommitmentOutcome
): HumanCommitmentSettlement['status'] => {
  if (outcome.outcome === 'accepted') {
    return 'succeeded'
  }
  if (outcome.outcome === 'rejected') {
    return 'failed'
  }
  return 'outcome_unknown'
}

const outcomeCodeOf = (outcome: CommitmentOutcome): string => {
  if (outcome.outcome === 'accepted') {
    return 'accepted'
  }
  return outcome.code
}

export const classifyUnexpectedThrow = (): CommitmentOutcome =>
  commitmentOutcomeSchema.parse({
    code: 'unexpected_throw',
    message: 'The commitment handler threw after claim',
    outcome: 'unknown',
  })

const classifyStaleRunning = (): CommitmentOutcome =>
  commitmentOutcomeSchema.parse({
    code: STALE_HUMAN_COMMITMENT_CODE,
    message: 'The running commitment aged past the stale classifier window',
    outcome: 'unknown',
  })

const appendResultAndCas = async ({
  approvalActionId,
  brandId,
  claim,
  now,
  outcome,
  policySnapshot,
  transaction,
}: {
  readonly approvalActionId: string
  readonly brandId: string
  readonly claim: Pick<
    ClaimedHumanCommitment,
    | 'agentActorId'
    | 'agentActorKey'
    | 'kind'
    | 'startedAt'
    | 'taskId'
    | 'workerKey'
  >
  readonly now: Date
  readonly outcome: CommitmentOutcome
  readonly policySnapshot: unknown
  readonly transaction: BrainTransaction
}): Promise<HumanCommitmentSettlement> => {
  const taskKind = getTaskKind(claim.kind)
  let classified = outcome
  let receipt: unknown
  if (outcome.outcome === 'accepted') {
    const parsedReceipt = taskKind.commitment?.receiptSchema.safeParse(
      outcome.receipt
    )
    if (parsedReceipt === undefined || !parsedReceipt.success) {
      classified = commitmentOutcomeSchema.parse({
        code: 'invalid_receipt',
        message: 'The accepted receipt failed the registered schema',
        outcome: 'unknown',
      })
    } else {
      receipt = parsedReceipt.data
    }
  }
  const status = statusOf(classified)
  const actionId = randomUUID()
  const payload = commitmentResultActionPayloadSchema.parse(
    classified.outcome === 'accepted'
      ? {
          authorizedByActionId: approvalActionId,
          outcome: 'accepted',
          receipt,
          taskId: claim.taskId,
        }
      : {
          authorizedByActionId: approvalActionId,
          code: classified.code,
          message: classified.message,
          outcome: classified.outcome,
          taskId: claim.taskId,
        }
  )
  await requireTrustedAgentActor(transaction, {
    actorId: claim.agentActorId,
    actorKey: claim.agentActorKey,
  })
  await transaction.insert(actions).values({
    actorId: claim.agentActorId,
    brandId,
    createdAt: now,
    effectClass: taskKind.commitment?.effectClass ?? 'reversible-external',
    id: actionId,
    payload,
    policySnapshot,
    rationale: `Record the provider Result for ${claim.kind}`,
    taskId: claim.taskId,
    type: 'commitment_result',
  })
  const [settled] = await transaction
    .update(tasks)
    .set({
      finishedAt: now,
      outcomeCode: outcomeCodeOf(classified),
      resultActionId: actionId,
      status,
    })
    .where(
      and(
        eq(tasks.id, claim.taskId),
        eq(tasks.brandId, brandId),
        eq(tasks.kind, claim.kind),
        eq(tasks.workerKey, claim.workerKey),
        eq(tasks.status, 'running'),
        eq(tasks.startedAt, claim.startedAt)
      )
    )
    .returning({ id: tasks.id })
  if (settled === undefined) {
    return fail(
      'invalid_operation',
      'Human commitment Result settlement lost its running race'
    )
  }
  return {
    actionId,
    status,
    taskId: claim.taskId,
  }
}

export const settleHumanCommitmentResult = async ({
  claim,
  database,
  now,
  outcome,
}: {
  readonly claim: ClaimedHumanCommitment
  readonly database: Database
  readonly now: Date
  readonly outcome: CommitmentOutcome | 'unexpected_throw'
}): Promise<HumanCommitmentSettlement> => {
  const classified =
    outcome === 'unexpected_throw'
      ? classifyUnexpectedThrow()
      : commitmentOutcomeSchema.parse(outcome)

  return await database.transaction(async (transaction) => {
    const [task] = await transaction
      .select({
        approvalActionId: tasks.approvalActionId,
        startedAt: tasks.startedAt,
        status: tasks.status,
      })
      .from(tasks)
      .where(and(eq(tasks.id, claim.taskId), eq(tasks.brandId, claim.brandId)))
      .for('update')
      .limit(1)
    if (task === undefined) {
      return fail('task_not_found', 'Result settlement target is missing')
    }
    if (
      task.status !== 'running' ||
      !humanCommitmentGenerationMatches(task.startedAt, claim.startedAt)
    ) {
      return fail(
        'task_not_running',
        'Result settlement requires the claimed running generation'
      )
    }
    if (task.approvalActionId === null) {
      return fail('invalid_task', 'Running commitment has no Approval Action')
    }
    const [approval] = await transaction
      .select({ policySnapshot: actions.policySnapshot })
      .from(actions)
      .where(
        and(
          eq(actions.id, task.approvalActionId),
          eq(actions.brandId, claim.brandId)
        )
      )
      .limit(1)
    if (approval === undefined) {
      return fail('invalid_task', 'Running commitment has no Approval Action')
    }
    return await appendResultAndCas({
      approvalActionId: task.approvalActionId,
      brandId: claim.brandId,
      claim,
      now,
      outcome: classified,
      policySnapshot: approval.policySnapshot,
      transaction,
    })
  })
}

export const settleStaleHumanCommitments = async ({
  database,
  kinds,
  now,
  staleAfterMs = HUMAN_COMMITMENT_STALE_AFTER_MS,
  workerKey,
}: {
  readonly database: Database
  readonly kinds: readonly [RegisteredTaskKindKey, ...RegisteredTaskKindKey[]]
  readonly now: Date
  readonly staleAfterMs?: number
  readonly workerKey: AgentKey
}): Promise<readonly HumanCommitmentSettlement[]> => {
  const cutoff = new Date(now.getTime() - staleAfterMs)
  const registeredAgent = getAgent(workerKey)
  const staleRows = await database
    .select({
      approvalActionId: tasks.approvalActionId,
      brandId: tasks.brandId,
      id: tasks.id,
      kind: tasks.kind,
      startedAt: tasks.startedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.executionMode, 'direct'),
        eq(tasks.activation, 'human'),
        eq(tasks.workerKey, workerKey),
        inArray(tasks.kind, [...kinds]),
        eq(tasks.status, 'running'),
        lte(tasks.startedAt, cutoff)
      )
    )

  const settlements: HumanCommitmentSettlement[] = []
  for (const row of staleRows) {
    if (row.startedAt === null || row.approvalActionId === null) {
      continue
    }
    const settlement = await database.transaction(async (transaction) => {
      const [task] = await transaction
        .select({
          approvalActionId: tasks.approvalActionId,
          startedAt: tasks.startedAt,
          status: tasks.status,
        })
        .from(tasks)
        .where(and(eq(tasks.id, row.id), eq(tasks.brandId, row.brandId)))
        .for('update')
        .limit(1)
      if (
        task === undefined ||
        task.status !== 'running' ||
        task.startedAt === null ||
        task.approvalActionId === null
      ) {
        return null
      }
      const [approval] = await transaction
        .select({ policySnapshot: actions.policySnapshot })
        .from(actions)
        .where(
          and(
            eq(actions.id, task.approvalActionId),
            eq(actions.brandId, row.brandId)
          )
        )
        .limit(1)
      if (approval === undefined) {
        return fail('invalid_task', 'Stale commitment has no Approval Action')
      }
      const [agentActor] = await transaction
        .select({ actorKey: actors.actorKey, id: actors.id })
        .from(actors)
        .where(eq(actors.actorKey, registeredAgent.actorKey))
        .limit(1)
      if (agentActor === undefined) {
        return fail(
          'invalid_task',
          'Stale commitment has no trusted Agent Actor'
        )
      }
      return await appendResultAndCas({
        approvalActionId: task.approvalActionId,
        brandId: row.brandId,
        claim: {
          agentActorId: agentActor.id,
          agentActorKey: registeredAgent.actorKey,
          kind: row.kind as RegisteredTaskKindKey,
          startedAt: taskGenerationOf(task.startedAt),
          taskId: row.id,
          workerKey,
        },
        now,
        outcome: classifyStaleRunning(),
        policySnapshot: approval.policySnapshot,
        transaction,
      })
    })
    if (settlement !== null) {
      settlements.push(settlement)
    }
  }

  return settlements
}
