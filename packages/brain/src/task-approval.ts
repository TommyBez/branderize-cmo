import { randomUUID } from 'node:crypto'

import { getTaskKind, registeredTaskKindKeySchema } from '@repo/agents'
import type { Database } from '@repo/db/client'
import { actions, tasks } from '@repo/db/schema/domain'
import type { PolicyDecision } from '@repo/policy'
import { evaluatePolicy } from '@repo/policy'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { operationKey, requestHash } from './canonical'
import type { TrustedMemberAccess } from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  ensureHumanActor,
  type HumanActorBinding,
  requireCurrentBrandMember,
} from './internal'
import { readActionReceipt } from './receipts'
import {
  type ApproveTaskInput,
  type ApproveTaskReceipt,
  approveTaskInputSchema,
  approveTaskReceiptSchema,
  commitmentApprovalActionPayloadSchema,
  SERIALIZED_COMMITMENT_FIXTURE_KIND,
  serializedCommitmentFixturePayloadSchema,
} from './task-commitment-contracts'

const COMMITMENT_CONFLICT_LOCK_NAMESPACE = 'branderize:commitment-conflict:v1'
const HUMAN_APPROVED_STATUSES = ['queued', 'running'] as const

const requireAllowed = (policy: PolicyDecision): void => {
  if (policy.verdict !== 'allowed') {
    fail('access_denied', `Policy denied commitment approval: ${policy.reason}`)
  }
}

const deriveConflictKey = ({
  kind,
  payload,
}: {
  readonly kind: string
  readonly payload: unknown
}): string | null => {
  if (kind === SERIALIZED_COMMITMENT_FIXTURE_KIND) {
    const parsed = serializedCommitmentFixturePayloadSchema.parse(payload)
    return `serialized-fixture:${parsed.targetKey}`
  }
  if (!registeredTaskKindKeySchema.safeParse(kind).success) {
    return fail(
      'unsupported_task_kind',
      'Approval target kind is not registered'
    )
  }
  return null
}

const acquireConflictLock = async ({
  brandId,
  conflictKey,
  transaction,
}: {
  readonly brandId: string
  readonly conflictKey: string
  readonly transaction: BrainTransaction
}): Promise<void> => {
  const lockIdentity = `${COMMITMENT_CONFLICT_LOCK_NAMESPACE}:${brandId}:${conflictKey}`
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`
  )
}

const findBlockingCommitment = async ({
  brandId,
  conflictKey,
  transaction,
}: {
  readonly brandId: string
  readonly conflictKey: string
  readonly transaction: BrainTransaction
}): Promise<string | undefined> => {
  const [blocker] = await transaction
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.brandId, brandId),
        eq(tasks.activation, 'human'),
        eq(tasks.commitmentConflictKey, conflictKey),
        inArray(tasks.status, HUMAN_APPROVED_STATUSES)
      )
    )
    .limit(1)
  return blocker?.id
}

interface LockedApprovalTask {
  readonly activation: string
  readonly approvedAt: Date | null
  readonly executionMode: string
  readonly kind: string
  readonly payload: unknown
  readonly payloadHash: string
  readonly revision: number
  readonly status: string
}

const lockApprovalTask = async ({
  brandId,
  taskId,
  transaction,
}: {
  readonly brandId: string
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<LockedApprovalTask> => {
  const [task] = await transaction
    .select({
      activation: tasks.activation,
      approvedAt: tasks.approvedAt,
      executionMode: tasks.executionMode,
      kind: tasks.kind,
      payload: tasks.payload,
      payloadHash: tasks.payloadHash,
      revision: tasks.revision,
      status: tasks.status,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.brandId, brandId)))
    .for('update')
    .limit(1)
  if (task === undefined) {
    return fail(
      'task_not_found',
      'Approval target does not exist in this brand'
    )
  }
  return task
}

const validatedApprovalPayload = ({
  expectedRevision,
  task,
}: {
  readonly expectedRevision: number
  readonly task: LockedApprovalTask
}): unknown => {
  if (task.status === 'queued' || task.approvedAt !== null) {
    return fail(
      'invalid_operation',
      'Only an awaiting-approval commitment can be approved'
    )
  }
  if (task.status !== 'awaiting_approval') {
    return fail(
      'invalid_operation',
      'Only an awaiting-approval commitment can be approved'
    )
  }
  if (task.revision !== expectedRevision) {
    return fail(
      'stale_revision',
      'The commitment revision changed before approval'
    )
  }
  if (task.activation !== 'human' || task.executionMode !== 'direct') {
    return fail('invalid_task', 'Approval target is not a human commitment')
  }

  const isFixtureKind = task.kind === SERIALIZED_COMMITMENT_FIXTURE_KIND
  const registeredKind = registeredTaskKindKeySchema.safeParse(task.kind)
  if (!(isFixtureKind || registeredKind.success)) {
    return fail(
      'unsupported_task_kind',
      'Approval target kind is not registered'
    )
  }
  const taskKind = registeredKind.success
    ? getTaskKind(registeredKind.data)
    : null
  if (
    taskKind !== null &&
    (taskKind.activation !== 'human' ||
      taskKind.executionMode !== 'direct' ||
      taskKind.commitment === undefined)
  ) {
    return fail('invalid_task', 'Approval target is not a human commitment')
  }
  const payload =
    taskKind === null
      ? serializedCommitmentFixturePayloadSchema.parse(task.payload)
      : taskKind.briefSchema.parse(task.payload)
  if (requestHash(payload) !== task.payloadHash) {
    return fail(
      'invalid_task',
      'The persisted commitment payload no longer matches its hash'
    )
  }
  return payload
}

const approvalEffectOf = (kind: string) => {
  const registeredKind = registeredTaskKindKeySchema.safeParse(kind)
  if (!registeredKind.success) {
    return {
      class: 'reversible-external' as const,
      phase: 'external-commitment' as const,
    }
  }
  return {
    class:
      getTaskKind(registeredKind.data).commitment?.effectClass ??
      'reversible-external',
    phase: 'external-commitment' as const,
  }
}

const conflictBusyReceipt = async ({
  brandId,
  conflictKey,
  taskId,
  transaction,
}: {
  readonly brandId: string
  readonly conflictKey: string | null
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<ApproveTaskReceipt | null> => {
  if (conflictKey === null) {
    return null
  }
  await acquireConflictLock({
    brandId,
    conflictKey,
    transaction,
  })
  const blockingTaskId = await findBlockingCommitment({
    brandId,
    conflictKey,
    transaction,
  })
  if (blockingTaskId === undefined) {
    return null
  }
  return approveTaskReceiptSchema.parse({
    blockingTaskId,
    outcome: 'target_busy',
    taskId,
  })
}

const writeApprovedCommitment = async ({
  access,
  approvedAt,
  conflictKey,
  effect,
  expectedRevision,
  humanActor,
  kind,
  payloadHash,
  policy,
  receiptOperationKey,
  revision,
  semanticHash,
  taskId,
  transaction,
}: {
  readonly access: TrustedMemberAccess
  readonly approvedAt: Date
  readonly conflictKey: string | null
  readonly effect: ReturnType<typeof approvalEffectOf>
  readonly expectedRevision: number
  readonly humanActor: HumanActorBinding
  readonly kind: string
  readonly payloadHash: string
  readonly policy: PolicyDecision
  readonly receiptOperationKey: string
  readonly revision: number
  readonly semanticHash: string
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<ApproveTaskReceipt> => {
  requireAllowed(policy)
  const actionId = randomUUID()
  const receipt = approveTaskReceiptSchema.parse({
    actionId,
    approvedAt: approvedAt.toISOString(),
    conflictKey,
    effect,
    kind,
    outcome: 'approved',
    payloadHash,
    revision,
    taskId,
  })
  commitmentApprovalActionPayloadSchema.parse({
    conflictKey,
    effect,
    kind,
    payloadHash,
    revision,
    taskId,
  })
  await transaction.insert(actions).values({
    actorId: humanActor.id,
    brandId: access.brandId,
    createdAt: approvedAt,
    effectClass: effect.class,
    id: actionId,
    operationKey: receiptOperationKey,
    payload: receipt,
    policySnapshot: policy,
    rationale: `Approve the registered ${kind} commitment`,
    requestHash: semanticHash,
    taskId,
    type: 'commitment_approved',
  })
  const [updated] = await transaction
    .update(tasks)
    .set({
      approvalActionId: actionId,
      approvedAt,
      commitmentConflictKey: conflictKey,
      status: 'queued',
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.brandId, access.brandId),
        eq(tasks.revision, expectedRevision),
        eq(tasks.status, 'awaiting_approval')
      )
    )
    .returning({ id: tasks.id })
  if (updated === undefined) {
    return fail(
      'invalid_operation',
      'Commitment approval lost its awaiting-approval race'
    )
  }
  return receipt
}

export const approveTask = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: ApproveTaskInput
}): Promise<ApproveTaskReceipt> => {
  const parsed = approveTaskInputSchema.parse(input)
  const receiptOperationKey = operationKey(
    'approve-task:human',
    parsed.requestId
  )
  const semanticHash = requestHash({
    brandId: access.brandId,
    expectedRevision: parsed.expectedRevision,
    organizationId: access.organizationId,
    taskId: parsed.taskId,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    const humanActor = await ensureHumanActor(transaction, access.userId)
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: approveTaskReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    const task = await lockApprovalTask({
      brandId: access.brandId,
      taskId: parsed.taskId,
      transaction,
    })
    const payload = validatedApprovalPayload({
      expectedRevision: parsed.expectedRevision,
      task,
    })
    const conflictKey = deriveConflictKey({
      kind: task.kind,
      payload,
    })
    const busy = await conflictBusyReceipt({
      brandId: access.brandId,
      conflictKey,
      taskId: parsed.taskId,
      transaction,
    })
    if (busy !== null) {
      return busy
    }

    const effect = approvalEffectOf(task.kind)
    const policy = evaluatePolicy({
      actor: { actorKey: humanActor.actorKey, kind: 'human' },
      authorization: {
        humanActorKey: humanActor.actorKey,
        kind: 'member',
        membership: { kind: 'current', role: currentMember.role },
        mode: 'commitment-approval',
      },
      capability: { kind: 'not-required' },
      currentBrandRestrictions: [],
      effect,
      origin: { kind: 'origin-free' },
    })
    return await writeApprovedCommitment({
      access,
      approvedAt: new Date(),
      conflictKey,
      effect,
      expectedRevision: parsed.expectedRevision,
      humanActor,
      kind: task.kind,
      payloadHash: task.payloadHash,
      policy,
      receiptOperationKey,
      revision: task.revision,
      semanticHash,
      taskId: parsed.taskId,
      transaction,
    })
  })
}
