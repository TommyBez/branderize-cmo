import type { TaskPayloadOf } from '@repo/agents'
import {
  type AgentKey,
  getAgent,
  getTaskKind,
  type RegisteredTaskKindKey,
  registeredTaskKindKeySchema,
} from '@repo/agents'
import type { Database } from '@repo/db/client'
import {
  actions,
  actors,
  brandConnections,
  tasks,
} from '@repo/db/schema/domain'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { requestHash } from './canonical'
import { fail } from './errors'
import type { BrainTransaction } from './internal'
import {
  approveTaskReceiptSchema,
  commitmentApprovalActionPayloadSchema,
  isHumanCommitmentKind,
} from './task-commitment-contracts'
import {
  type TaskGeneration,
  taskExecutionGenerationMatches,
  taskGenerationOf,
} from './task-contracts'

export const HUMAN_COMMITMENT_STALE_AFTER_MS = 10 * 60 * 1000

export interface ClaimedHumanCommitment<
  TKind extends RegisteredTaskKindKey = RegisteredTaskKindKey,
> {
  readonly agentActorId: string
  readonly agentActorKey: `agent:${AgentKey}`
  readonly approvalActionId: string
  readonly brandId: string
  readonly kind: TKind
  readonly payload: TaskPayloadOf<TKind>
  readonly startedAt: TaskGeneration
  readonly taskId: string
  readonly workerKey: AgentKey
}

export type HumanCommitmentClaimResult<
  TKind extends RegisteredTaskKindKey = RegisteredTaskKindKey,
> =
  | {
      readonly outcome: 'claimed'
      readonly claim: ClaimedHumanCommitment<TKind>
    }
  | {
      readonly capabilityKey: `connection:${string}`
      readonly outcome: 'capability_missing'
      readonly taskId: string
    }
  | { readonly outcome: 'expired'; readonly taskId: string }
  | { readonly outcome: 'empty' }

const revalidateApprovalReceipt = ({
  action,
  conflictKey,
  payloadHash,
  revision,
  taskId,
}: {
  readonly action:
    | {
        readonly payload: unknown
        readonly taskId: string | null
        readonly type: string
      }
    | undefined
  readonly conflictKey: string | null
  readonly payloadHash: string
  readonly revision: number
  readonly taskId: string
}) => {
  if (action === undefined || action.type !== 'commitment_approved') {
    return fail('invalid_task', 'Human claim is missing its Approval Action')
  }
  if (action.taskId !== taskId) {
    return fail('invalid_task', 'Approval Action does not bind this commitment')
  }
  const receipt = approveTaskReceiptSchema.safeParse(action.payload)
  if (!receipt.success) {
    return fail('invalid_task', 'Approval Action receipt is malformed')
  }
  if (receipt.data.outcome !== 'approved') {
    return fail('invalid_task', 'Approval Action receipt is malformed')
  }
  const approved = receipt.data
  commitmentApprovalActionPayloadSchema.parse({
    conflictKey: approved.conflictKey,
    effect: approved.effect,
    kind: approved.kind,
    payloadHash: approved.payloadHash,
    revision: approved.revision,
    taskId: approved.taskId,
  })
  const receiptMatches =
    approved.taskId === taskId &&
    approved.revision === revision &&
    approved.payloadHash === payloadHash &&
    approved.conflictKey === conflictKey
  if (!receiptMatches) {
    return fail(
      'invalid_task',
      'Approval Action no longer matches the queued commitment'
    )
  }
}

interface LockedQueuedHumanTask {
  readonly approvalActionId: string | null
  readonly brandId: string
  readonly commitmentConflictKey: string | null
  readonly executeBefore: Date | null
  readonly id: string
  readonly kind: string
  readonly payload: unknown
  readonly payloadHash: string
  readonly revision: number
  readonly workerKey: string
}

const selectNextQueuedHumanTask = async ({
  excludeTaskIds,
  kindList,
  transaction,
  workerKey,
}: {
  readonly excludeTaskIds: readonly string[]
  readonly kindList: readonly string[]
  readonly transaction: BrainTransaction
  readonly workerKey: AgentKey
}): Promise<LockedQueuedHumanTask | undefined> => {
  const [task] = await transaction
    .select({
      approvalActionId: tasks.approvalActionId,
      brandId: tasks.brandId,
      commitmentConflictKey: tasks.commitmentConflictKey,
      executeBefore: tasks.executeBefore,
      id: tasks.id,
      kind: tasks.kind,
      payload: tasks.payload,
      payloadHash: tasks.payloadHash,
      revision: tasks.revision,
      workerKey: tasks.workerKey,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.executionMode, 'direct'),
        eq(tasks.activation, 'human'),
        eq(tasks.workerKey, workerKey),
        inArray(tasks.kind, kindList),
        eq(tasks.status, 'queued'),
        isNull(tasks.sessionId),
        excludeTaskIds.length > 0
          ? sql`${tasks.id} NOT IN (${sql.join(
              excludeTaskIds.map((taskId) => sql`${taskId}::uuid`),
              sql`, `
            )})`
          : sql`true`
      )
    )
    .orderBy(
      sql`${tasks.executeBefore} ASC NULLS LAST`,
      tasks.approvedAt,
      tasks.id
    )
    .for('update', { skipLocked: true })
    .limit(1)
  return task
}

const expireQueuedCommitment = async ({
  brandId,
  now,
  taskId,
  transaction,
}: {
  readonly brandId: string
  readonly now: Date
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<boolean> => {
  const [expired] = await transaction
    .update(tasks)
    .set({
      finishedAt: now,
      outcomeCode: 'DEADLINE_EXPIRED',
      status: 'expired',
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.brandId, brandId),
        eq(tasks.status, 'queued'),
        eq(tasks.activation, 'human'),
        eq(tasks.executionMode, 'direct')
      )
    )
    .returning({ id: tasks.id })
  return expired !== undefined
}

const parseQueuedHumanCommitment = <TKind extends RegisteredTaskKindKey>({
  kinds,
  task,
  workerKey,
}: {
  readonly kinds: readonly [TKind, ...TKind[]]
  readonly task: LockedQueuedHumanTask
  readonly workerKey: AgentKey
}): {
  readonly approvalActionId: string
  readonly kind: TKind
  readonly payload: TaskPayloadOf<TKind>
  readonly providerSlot: 'notion' | 'typefully'
} => {
  const registeredKind = registeredTaskKindKeySchema.safeParse(task.kind)
  if (
    !(
      registeredKind.success &&
      kinds.includes(registeredKind.data as TKind) &&
      task.workerKey === workerKey
    )
  ) {
    return fail('invalid_task', 'Queued human commitment is malformed')
  }
  const kind = registeredKind.data as TKind
  const taskKind = getTaskKind(kind)
  const payload = taskKind.briefSchema.safeParse(task.payload)
  if (!payload.success || requestHash(payload.data) !== task.payloadHash) {
    return fail('invalid_task', 'Queued human commitment is malformed')
  }
  if (task.approvalActionId === null) {
    return fail(
      'invalid_task',
      'Queued human commitment has no Approval Action'
    )
  }
  const providerSlot = taskKind.commitment?.providerSlot
  if (providerSlot === undefined) {
    return fail('invalid_task', 'Human commitment is missing a provider slot')
  }
  return {
    approvalActionId: task.approvalActionId,
    kind,
    payload: payload.data as TaskPayloadOf<TKind>,
    providerSlot,
  }
}

const expireIfDue = async ({
  now,
  task,
  transaction,
}: {
  readonly now: Date
  readonly task: LockedQueuedHumanTask
  readonly transaction: BrainTransaction
}): Promise<{
  readonly outcome: 'expired'
  readonly taskId: string
} | null> => {
  if (
    task.executeBefore === null ||
    task.executeBefore.getTime() > now.getTime()
  ) {
    return null
  }
  const expired = await expireQueuedCommitment({
    brandId: task.brandId,
    now,
    taskId: task.id,
    transaction,
  })
  if (!expired) {
    return fail('invalid_task', 'Deadline expiry lost its queue race')
  }
  return { outcome: 'expired', taskId: task.id }
}

const loadAndRevalidateApproval = async ({
  task,
  transaction,
}: {
  readonly task: LockedQueuedHumanTask & { readonly approvalActionId: string }
  readonly transaction: BrainTransaction
}): Promise<void> => {
  const [approvalAction] = await transaction
    .select({
      payload: actions.payload,
      taskId: actions.taskId,
      type: actions.type,
    })
    .from(actions)
    .where(
      and(
        eq(actions.id, task.approvalActionId),
        eq(actions.brandId, task.brandId)
      )
    )
    .for('share')
    .limit(1)
  revalidateApprovalReceipt({
    action: approvalAction,
    conflictKey: task.commitmentConflictKey,
    payloadHash: task.payloadHash,
    revision: task.revision,
    taskId: task.id,
  })
}

const requireActiveProviderSlot = async ({
  brandId,
  providerSlot,
  taskId,
  transaction,
}: {
  readonly brandId: string
  readonly providerSlot: 'notion' | 'typefully'
  readonly taskId: string
  readonly transaction: BrainTransaction
}): Promise<{
  readonly capabilityKey: `connection:${string}`
  readonly outcome: 'capability_missing'
  readonly taskId: string
} | null> => {
  const [connection] = await transaction
    .select({ id: brandConnections.id })
    .from(brandConnections)
    .where(
      and(
        eq(brandConnections.brandId, brandId),
        eq(brandConnections.providerSlot, providerSlot),
        eq(brandConnections.status, 'active')
      )
    )
    .limit(1)
  if (connection !== undefined) {
    return null
  }
  return {
    capabilityKey: `connection:${providerSlot}`,
    outcome: 'capability_missing',
    taskId,
  }
}

const casHumanClaim = async <TKind extends RegisteredTaskKindKey>({
  approvalActionId,
  kind,
  now,
  payload,
  registeredAgentKey,
  task,
  transaction,
  workerKey,
}: {
  readonly approvalActionId: string
  readonly kind: TKind
  readonly now: Date
  readonly payload: TaskPayloadOf<TKind>
  readonly registeredAgentKey: `agent:${AgentKey}`
  readonly task: LockedQueuedHumanTask
  readonly transaction: BrainTransaction
  readonly workerKey: AgentKey
}): Promise<HumanCommitmentClaimResult<TKind>> => {
  const [agentActor] = await transaction
    .select({ actorKey: actors.actorKey, id: actors.id, type: actors.type })
    .from(actors)
    .where(eq(actors.actorKey, registeredAgentKey))
    .for('share')
    .limit(1)
  if (
    agentActor === undefined ||
    agentActor.type !== 'agent' ||
    agentActor.actorKey !== registeredAgentKey
  ) {
    return fail(
      'invalid_task',
      'Registered commitment has no trusted Agent Actor'
    )
  }

  const [claimed] = await transaction
    .update(tasks)
    .set({
      startedAt: now,
      status: 'running',
    })
    .where(
      and(
        eq(tasks.id, task.id),
        eq(tasks.brandId, task.brandId),
        eq(tasks.kind, kind),
        eq(tasks.workerKey, workerKey),
        eq(tasks.status, 'queued'),
        isNull(tasks.startedAt)
      )
    )
    .returning({ id: tasks.id, startedAt: tasks.startedAt })
  if (claimed === undefined || claimed.startedAt === null) {
    return fail('already_claimed', 'Human commitment claim lost its queue race')
  }

  return {
    claim: {
      agentActorId: agentActor.id,
      agentActorKey: registeredAgentKey,
      approvalActionId,
      brandId: task.brandId,
      kind,
      payload,
      startedAt: taskGenerationOf(claimed.startedAt),
      taskId: task.id,
      workerKey,
    },
    outcome: 'claimed',
  }
}

export const claimNextDueHumanCommitment = async <
  TKind extends RegisteredTaskKindKey,
>({
  database,
  excludeTaskIds = [],
  kinds,
  now,
  workerKey,
}: {
  readonly database: Database
  readonly excludeTaskIds?: readonly string[]
  readonly kinds: readonly [TKind, ...TKind[]]
  readonly now: Date
  readonly workerKey: AgentKey
}): Promise<HumanCommitmentClaimResult<TKind>> => {
  const registeredAgent = getAgent(workerKey)
  const kindList = [...kinds]
  for (const kind of kindList) {
    if (
      !isHumanCommitmentKind(kind) ||
      getTaskKind(kind).workerKey !== workerKey
    ) {
      return fail(
        'invalid_task',
        'Human claim kinds must be this worker’s direct commitments'
      )
    }
  }

  return await database.transaction(async (transaction) => {
    const task = await selectNextQueuedHumanTask({
      excludeTaskIds,
      kindList,
      transaction,
      workerKey,
    })
    if (task === undefined) {
      return { outcome: 'empty' }
    }

    const parsed = parseQueuedHumanCommitment({
      kinds,
      task,
      workerKey,
    })
    const expired = await expireIfDue({
      now,
      task,
      transaction,
    })
    if (expired !== null) {
      return expired
    }

    await loadAndRevalidateApproval({
      task: {
        ...task,
        approvalActionId: parsed.approvalActionId,
      },
      transaction,
    })

    const capability = await requireActiveProviderSlot({
      brandId: task.brandId,
      providerSlot: parsed.providerSlot,
      taskId: task.id,
      transaction,
    })
    if (capability !== null) {
      return capability
    }

    return await casHumanClaim({
      approvalActionId: parsed.approvalActionId,
      kind: parsed.kind,
      now,
      payload: parsed.payload,
      registeredAgentKey: registeredAgent.actorKey,
      task,
      transaction,
      workerKey,
    })
  })
}

export const humanCommitmentGenerationMatches = (
  persistedStartedAt: Date | null,
  expectedStartedAt: Date
): boolean =>
  taskExecutionGenerationMatches(persistedStartedAt, expectedStartedAt)

export const claimRegisteredHumanCommitment = async <
  TKind extends RegisteredTaskKindKey,
>({
  database,
  kind,
  now,
}: {
  readonly database: Database
  readonly kind: TKind
  readonly now: Date
}): Promise<HumanCommitmentClaimResult<TKind>> => {
  const taskKind = getTaskKind(kind)
  return await claimNextDueHumanCommitment({
    database,
    kinds: [kind],
    now,
    workerKey: taskKind.workerKey,
  })
}
