import { randomUUID } from 'node:crypto'

import type { Database } from '@repo/db/client'
import { actions, tasks } from '@repo/db/schema/domain'
import { evaluatePolicy, type PolicyDecision } from '@repo/policy'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { operationKey, requestHash } from './canonical'
import type { TrustedMemberAccess } from './context'
import { fail } from './errors'
import {
  requireCurrentBrandMember,
  requireMutationRole,
  requireTrustedHumanActor,
} from './internal'
import { readActionReceipt } from './receipts'
import {
  lockBrandCommitmentTask,
  requireHumanCommitmentTask,
} from './task-dismissal'

const nonBlankSchema = z.string().trim().min(1)
const CANCELLABLE_STATUSES = ['awaiting_approval', 'queued'] as const

export const COMMITMENT_CANCELLED_ACTION_TYPE = 'commitment_cancelled' as const

export const cancelTaskInputSchema = z
  .object({
    requestId: nonBlankSchema.max(500),
    taskId: z.uuid(),
  })
  .strict()

const cancelledTaskReceiptSchema = z
  .object({
    actionId: z.uuid(),
    finishedAt: z.iso.datetime(),
    kind: z.string().trim().min(1),
    outcome: z.literal('cancelled'),
    taskId: z.uuid(),
  })
  .strict()

const alreadyClaimedCancelReceiptSchema = z
  .object({
    outcome: z.literal('already_claimed'),
    taskId: z.uuid(),
  })
  .strict()

export const cancelTaskReceiptSchema = z.discriminatedUnion('outcome', [
  cancelledTaskReceiptSchema,
  alreadyClaimedCancelReceiptSchema,
])

export type CancelTaskInput = z.input<typeof cancelTaskInputSchema>
export type CancelTaskReceipt = z.infer<typeof cancelTaskReceiptSchema>

const requireAllowed = (policy: PolicyDecision): void => {
  if (policy.verdict !== 'allowed') {
    fail(
      'access_denied',
      `Policy denied commitment cancellation: ${policy.reason}`
    )
  }
}

const lostCancelReceipt = (taskId: string): CancelTaskReceipt =>
  alreadyClaimedCancelReceiptSchema.parse({
    outcome: 'already_claimed',
    taskId,
  })

export const cancelTask = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: CancelTaskInput
}): Promise<CancelTaskReceipt> => {
  const parsed = cancelTaskInputSchema.parse(input)
  const receiptOperationKey = operationKey(
    'cancel-task:human',
    parsed.requestId
  )
  const semanticHash = requestHash({
    brandId: access.brandId,
    organizationId: access.organizationId,
    taskId: parsed.taskId,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    await requireTrustedHumanActor(transaction, access)
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: cancelTaskReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    requireMutationRole(currentMember.role)
    const task = await lockBrandCommitmentTask({
      brandId: access.brandId,
      taskId: parsed.taskId,
      transaction,
    })
    if (task.status === 'running') {
      return lostCancelReceipt(parsed.taskId)
    }
    if (task.status !== 'awaiting_approval' && task.status !== 'queued') {
      return fail(
        'task_closed',
        'Only an awaiting-approval or queued commitment can be cancelled'
      )
    }
    requireHumanCommitmentTask(task)

    const policy = evaluatePolicy({
      actor: { actorKey: access.humanActorKey, kind: 'human' },
      authorization: {
        humanActorKey: access.humanActorKey,
        kind: 'member',
        membership: { kind: 'current', role: currentMember.role },
        mode: 'direct-mutation',
      },
      capability: { kind: 'not-required' },
      currentBrandRestrictions: [],
      effect: { phase: 'graph-internal' },
      origin: { kind: 'brand-administration' },
    })
    requireAllowed(policy)

    const finishedAt = new Date()
    const [updated] = await transaction
      .update(tasks)
      .set({
        finishedAt,
        status: 'cancelled',
      })
      .where(
        and(
          eq(tasks.id, parsed.taskId),
          eq(tasks.brandId, access.brandId),
          inArray(tasks.status, [...CANCELLABLE_STATUSES])
        )
      )
      .returning({ id: tasks.id })
    if (updated === undefined) {
      return lostCancelReceipt(parsed.taskId)
    }

    const actionId = randomUUID()
    const receipt = cancelledTaskReceiptSchema.parse({
      actionId,
      finishedAt: finishedAt.toISOString(),
      kind: task.kind,
      outcome: 'cancelled',
      taskId: parsed.taskId,
    })
    await transaction.insert(actions).values({
      actorId: access.humanActorId,
      brandId: access.brandId,
      createdAt: finishedAt,
      effectClass: 'graph-internal',
      id: actionId,
      operationKey: receiptOperationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale: 'Cancel the commitment from an authenticated product mutation',
      requestHash: semanticHash,
      taskId: parsed.taskId,
      type: COMMITMENT_CANCELLED_ACTION_TYPE,
    })
    return receipt
  })
}
