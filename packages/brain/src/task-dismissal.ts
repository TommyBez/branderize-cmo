import { randomUUID } from 'node:crypto'

import { getTaskKind, registeredTaskKindKeySchema } from '@repo/agents'
import type { Database } from '@repo/db/client'
import { actions, tasks } from '@repo/db/schema/domain'
import { evaluatePolicy, type PolicyDecision } from '@repo/policy'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { operationKey, requestHash } from './canonical'
import type { TrustedMemberAccess } from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  requireCurrentBrandMember,
  requireMutationRole,
  requireTrustedHumanActor,
} from './internal'
import { acquireCommitmentDismissalLock, readActionReceipt } from './receipts'
import {
  SERIALIZED_COMMITMENT_FIXTURE_KIND,
  serializedCommitmentFixturePayloadSchema,
} from './task-commitment-contracts'

const nonBlankSchema = z.string().trim().min(1)
const payloadHashSchema = z.string().regex(/^[a-f0-9]{64}$/u)

export const COMMITMENT_DISMISSED_ACTION_TYPE = 'commitment_dismissed' as const
export const COMMITMENT_REOPENED_ACTION_TYPE = 'commitment_reopened' as const

export const dismissTaskInputSchema = z
  .object({
    rationale: nonBlankSchema.max(3000).optional(),
    requestId: nonBlankSchema.max(500),
    taskId: z.uuid(),
  })
  .strict()

export const reopenTaskInputSchema = z
  .object({
    requestId: nonBlankSchema.max(500),
    taskId: z.uuid(),
  })
  .strict()

export const dismissTaskReceiptSchema = z
  .object({
    actionId: z.uuid(),
    brandId: z.uuid(),
    finishedAt: z.iso.datetime(),
    kind: z.string().trim().min(1),
    outcome: z.literal('commitment_dismissed'),
    payloadHash: payloadHashSchema,
    taskId: z.uuid(),
  })
  .strict()

export const reopenTaskReceiptSchema = z
  .object({
    actionId: z.uuid(),
    brandId: z.uuid(),
    kind: z.string().trim().min(1),
    outcome: z.literal('commitment_reopened'),
    payloadHash: payloadHashSchema,
    taskId: z.uuid(),
  })
  .strict()

export type DismissTaskInput = z.input<typeof dismissTaskInputSchema>
export type ReopenTaskInput = z.input<typeof reopenTaskInputSchema>
export type DismissTaskReceipt = z.infer<typeof dismissTaskReceiptSchema>
export type ReopenTaskReceipt = z.infer<typeof reopenTaskReceiptSchema>

export type CommitmentDismissalFact =
  | { readonly actionId: string; readonly fact: 'dismissal' }
  | { readonly actionId: string; readonly fact: 'reopen' }

interface LockedCommitmentTask {
  readonly activation: string
  readonly executionMode: string
  readonly kind: string
  readonly payload: unknown
  readonly payloadHash: string
  readonly status: string
}

const requireAllowed = (policy: PolicyDecision, operation: string): void => {
  if (policy.verdict !== 'allowed') {
    fail('access_denied', `Policy denied ${operation}: ${policy.reason}`)
  }
}

const evaluateDirectGraphPolicy = ({
  access,
  role,
}: {
  readonly access: TrustedMemberAccess
  readonly role: 'admin' | 'member' | 'owner' | 'viewer'
}): PolicyDecision =>
  evaluatePolicy({
    actor: { actorKey: access.humanActorKey, kind: 'human' },
    authorization: {
      humanActorKey: access.humanActorKey,
      kind: 'member',
      membership: { kind: 'current', role },
      mode: 'direct-mutation',
    },
    capability: { kind: 'not-required' },
    currentBrandRestrictions: [],
    effect: { phase: 'graph-internal' },
    origin: { kind: 'brand-administration' },
  })

export const lockBrandCommitmentTask = async ({
  brandId,
  taskId,
  transaction,
}: {
  readonly brandId: string
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<LockedCommitmentTask> => {
  const [task] = await transaction
    .select({
      activation: tasks.activation,
      executionMode: tasks.executionMode,
      kind: tasks.kind,
      payload: tasks.payload,
      payloadHash: tasks.payloadHash,
      status: tasks.status,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.brandId, brandId)))
    .for('update')
    .limit(1)
  if (task === undefined) {
    return fail('task_not_found', 'Commitment does not exist in this brand')
  }
  return task
}

export const requireHumanCommitmentTask = (task: {
  readonly activation: string
  readonly executionMode: string
  readonly kind: string
  readonly payload: unknown
  readonly payloadHash: string
}): void => {
  if (task.activation !== 'human' || task.executionMode !== 'direct') {
    fail('invalid_task', 'Target is not a human commitment')
  }
  const isFixtureKind = task.kind === SERIALIZED_COMMITMENT_FIXTURE_KIND
  const registeredKind = registeredTaskKindKeySchema.safeParse(task.kind)
  if (!(isFixtureKind || registeredKind.success)) {
    fail('unsupported_task_kind', 'Commitment kind is not registered')
  }
  if (registeredKind.success) {
    const taskKind = getTaskKind(registeredKind.data)
    if (
      taskKind.activation !== 'human' ||
      taskKind.executionMode !== 'direct' ||
      taskKind.commitment === undefined
    ) {
      fail('invalid_task', 'Target is not a human commitment')
    }
    const payload = taskKind.briefSchema.parse(task.payload)
    if (requestHash(payload) !== task.payloadHash) {
      fail(
        'invalid_task',
        'The persisted commitment payload no longer matches its hash'
      )
    }
    return
  }
  const fixturePayload = serializedCommitmentFixturePayloadSchema.parse(
    task.payload
  )
  if (requestHash(fixturePayload) !== task.payloadHash) {
    fail(
      'invalid_task',
      'The persisted commitment payload no longer matches its hash'
    )
  }
}

export const readLatestCommitmentDismissalFact = async ({
  brandId,
  kind,
  payloadHash,
  transaction,
}: {
  readonly brandId: string
  readonly kind: string
  readonly payloadHash: string
  readonly transaction: BrainTransaction
}): Promise<CommitmentDismissalFact | null> => {
  const [row] = await transaction
    .select({
      id: actions.id,
      type: actions.type,
    })
    .from(actions)
    .where(
      and(
        eq(actions.brandId, brandId),
        inArray(actions.type, [
          COMMITMENT_DISMISSED_ACTION_TYPE,
          COMMITMENT_REOPENED_ACTION_TYPE,
        ]),
        sql`(${actions.payload} ->> 'brandId') = ${brandId}`,
        sql`(${actions.payload} ->> 'kind') = ${kind}`,
        sql`(${actions.payload} ->> 'payloadHash') = ${payloadHash}`
      )
    )
    .orderBy(desc(actions.createdAt), desc(actions.id))
    .limit(1)
  if (row === undefined) {
    return null
  }
  if (row.type === COMMITMENT_DISMISSED_ACTION_TYPE) {
    return { actionId: row.id, fact: 'dismissal' }
  }
  if (row.type === COMMITMENT_REOPENED_ACTION_TYPE) {
    return { actionId: row.id, fact: 'reopen' }
  }
  return null
}

const insertCommitmentGraphAction = async ({
  access,
  actionId,
  actionType,
  finishedAt,
  operationKey: receiptOperationKey,
  policy,
  rationale,
  receipt,
  requestHash: semanticHash,
  taskId,
  transaction,
}: {
  readonly access: TrustedMemberAccess
  readonly actionId: string
  readonly actionType: string
  readonly finishedAt?: Date
  readonly operationKey: string
  readonly policy: PolicyDecision
  readonly rationale: string
  readonly receipt: unknown
  readonly requestHash: string
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<void> => {
  await transaction.insert(actions).values({
    actorId: access.humanActorId,
    brandId: access.brandId,
    createdAt: finishedAt,
    effectClass: 'graph-internal',
    id: actionId,
    operationKey: receiptOperationKey,
    payload: receipt,
    policySnapshot: policy,
    rationale,
    requestHash: semanticHash,
    taskId,
    type: actionType,
  })
}

export const dismissTask = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: DismissTaskInput
}): Promise<DismissTaskReceipt> => {
  const parsed = dismissTaskInputSchema.parse(input)
  const receiptOperationKey = operationKey(
    'dismiss-task:human',
    parsed.requestId
  )
  const semanticHash = requestHash({
    brandId: access.brandId,
    organizationId: access.organizationId,
    rationale: parsed.rationale ?? null,
    taskId: parsed.taskId,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    await requireTrustedHumanActor(transaction, access)
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: dismissTaskReceiptSchema,
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
    if (task.status !== 'awaiting_approval') {
      return fail(
        'task_closed',
        'Only an awaiting-approval commitment can be dismissed'
      )
    }
    requireHumanCommitmentTask(task)
    await acquireCommitmentDismissalLock({
      brandId: access.brandId,
      kind: task.kind,
      payloadHash: task.payloadHash,
      transaction,
    })

    const policy = evaluateDirectGraphPolicy({
      access,
      role: currentMember.role,
    })
    requireAllowed(policy, 'commitment dismissal')

    const finishedAt = new Date()
    const actionId = randomUUID()
    const receipt = dismissTaskReceiptSchema.parse({
      actionId,
      brandId: access.brandId,
      finishedAt: finishedAt.toISOString(),
      kind: task.kind,
      outcome: 'commitment_dismissed',
      payloadHash: task.payloadHash,
      taskId: parsed.taskId,
    })
    await insertCommitmentGraphAction({
      access,
      actionId,
      actionType: COMMITMENT_DISMISSED_ACTION_TYPE,
      finishedAt,
      operationKey: receiptOperationKey,
      policy,
      rationale:
        parsed.rationale ??
        'Dismiss the awaiting-approval commitment from an authenticated product mutation',
      receipt,
      requestHash: semanticHash,
      taskId: parsed.taskId,
      transaction,
    })
    const [updated] = await transaction
      .update(tasks)
      .set({
        finishedAt,
        status: 'dismissed',
      })
      .where(
        and(
          eq(tasks.id, parsed.taskId),
          eq(tasks.brandId, access.brandId),
          eq(tasks.status, 'awaiting_approval')
        )
      )
      .returning({ id: tasks.id })
    if (updated === undefined) {
      return fail(
        'task_closed',
        'Commitment dismissal lost its awaiting-approval race'
      )
    }
    return receipt
  })
}

export const reopenTask = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: ReopenTaskInput
}): Promise<ReopenTaskReceipt> => {
  const parsed = reopenTaskInputSchema.parse(input)
  const receiptOperationKey = operationKey(
    'reopen-task:human',
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
      receiptSchema: reopenTaskReceiptSchema,
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
    if (task.status !== 'dismissed') {
      return fail('task_closed', 'Only a dismissed commitment can be reopened')
    }
    requireHumanCommitmentTask(task)
    await acquireCommitmentDismissalLock({
      brandId: access.brandId,
      kind: task.kind,
      payloadHash: task.payloadHash,
      transaction,
    })
    const latestFact = await readLatestCommitmentDismissalFact({
      brandId: access.brandId,
      kind: task.kind,
      payloadHash: task.payloadHash,
      transaction,
    })
    if (latestFact?.fact !== 'dismissal') {
      return fail(
        'task_closed',
        'The dismissal tuple is not the latest fact for this payload'
      )
    }

    const policy = evaluateDirectGraphPolicy({
      access,
      role: currentMember.role,
    })
    requireAllowed(policy, 'commitment reopen')

    const actionId = randomUUID()
    const receipt = reopenTaskReceiptSchema.parse({
      actionId,
      brandId: access.brandId,
      kind: task.kind,
      outcome: 'commitment_reopened',
      payloadHash: task.payloadHash,
      taskId: parsed.taskId,
    })
    await insertCommitmentGraphAction({
      access,
      actionId,
      actionType: COMMITMENT_REOPENED_ACTION_TYPE,
      operationKey: receiptOperationKey,
      policy,
      rationale:
        'Reopen the dismissed payload so a new commitment can be prepared',
      receipt,
      requestHash: semanticHash,
      taskId: parsed.taskId,
      transaction,
    })
    return receipt
  })
}
