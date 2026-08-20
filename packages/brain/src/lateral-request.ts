import { randomUUID } from 'node:crypto'

import { getTaskKind, resolveLateralWorkEdge } from '@repo/agents'
import { taskIntentSnapshotSchema } from '@repo/agents/task-snapshot'
import type { Database } from '@repo/db/client'
import { actions, objects, tasks } from '@repo/db/schema/domain'
import { evaluatePolicy } from '@repo/policy'
import { and, eq } from 'drizzle-orm'

import { operationKey, requestHash } from './canonical'
import type { TrustedTaskExecution } from './context'
import { fail } from './errors'
import { type BrainTransaction, requireTrustedAgentActor } from './internal'
import { readActionReceipt } from './receipts'
import {
  createdLateralWorkReceiptSchema,
  type RequestLateralWorkInput,
  type RequestLateralWorkReceipt,
  requestLateralWorkInputSchema,
} from './task-contracts'
import { observeActiveSpecialistTask } from './task-request'

const readSourceReportObjectId = (payload: unknown): string | null => {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  if (!('sourceReportObjectId' in payload)) {
    return null
  }
  const value = payload.sourceReportObjectId
  return typeof value === 'string' && value.length > 0 ? value : null
}

const hasSourceTaskBinding = ({
  execution,
  task,
}: {
  readonly execution: TrustedTaskExecution
  readonly task: {
    readonly brandId: string
    readonly sessionId: string | null
    readonly startedAt: Date | null
    readonly workerKey: string
  }
}): boolean =>
  task.brandId === execution.brandId &&
  task.workerKey === execution.workerKey &&
  task.startedAt !== null &&
  task.startedAt.getTime() === execution.startedAt.getTime() &&
  task.sessionId === execution.rootSessionId

const observedLateralReceipt = (taskId: string): RequestLateralWorkReceipt => ({
  disposition: 'already_active',
  outcome: 'lateral_work_observed',
  taskId,
})

const lockRunningSourceTask = async ({
  execution,
  transaction,
}: {
  readonly execution: TrustedTaskExecution
  readonly transaction: BrainTransaction
}) => {
  const [sourceTask] = await transaction
    .select({
      brandId: tasks.brandId,
      intentId: tasks.intentId,
      intentSnapshot: tasks.intentSnapshot,
      sessionId: tasks.sessionId,
      startedAt: tasks.startedAt,
      status: tasks.status,
      workerKey: tasks.workerKey,
    })
    .from(tasks)
    .where(
      and(eq(tasks.id, execution.taskId), eq(tasks.brandId, execution.brandId))
    )
    .for('update')
    .limit(1)
  if (sourceTask === undefined) {
    return fail('task_not_found', 'Source specialist task does not exist')
  }
  if (!hasSourceTaskBinding({ execution, task: sourceTask })) {
    return fail('invalid_task', 'Source specialist task binding is invalid')
  }
  if (sourceTask.status !== 'running') {
    return fail(
      'task_not_running',
      'Lateral work requires a running source task'
    )
  }
  const intentSnapshot = taskIntentSnapshotSchema.safeParse(
    sourceTask.intentSnapshot
  )
  if (
    !intentSnapshot.success ||
    sourceTask.intentId !== intentSnapshot.data.intent_id ||
    intentSnapshot.data.brand_id !== execution.brandId
  ) {
    return fail('invalid_task', 'Source task Intent snapshot is invalid')
  }
  return {
    intentId: sourceTask.intentId,
    intentSnapshot: intentSnapshot.data,
  }
}

const requireSourceContentReport = async ({
  brandId,
  sourceReportObjectId,
  sourceTaskId,
  transaction,
}: {
  readonly brandId: string
  readonly sourceReportObjectId: string
  readonly sourceTaskId: string
  readonly transaction: BrainTransaction
}): Promise<void> => {
  const [sourceReport] = await transaction
    .select({
      objectId: objects.id,
      objectType: objects.type,
      producerTaskId: actions.taskId,
    })
    .from(objects)
    .innerJoin(
      actions,
      and(
        eq(actions.id, objects.producedBy),
        eq(actions.brandId, objects.brandId)
      )
    )
    .where(
      and(
        eq(objects.brandId, brandId),
        eq(objects.id, sourceReportObjectId),
        eq(objects.status, 'active')
      )
    )
    .for('share')
    .limit(1)
  if (
    sourceReport === undefined ||
    sourceReport.objectType !== 'report' ||
    sourceReport.producerTaskId !== sourceTaskId
  ) {
    return fail(
      'invalid_output',
      'Lateral work requires a same-brand Content report from this task'
    )
  }
}

export const requestLateralWork = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedTaskExecution
  readonly database: Database
  readonly input: RequestLateralWorkInput
}): Promise<RequestLateralWorkReceipt> => {
  const parsed = requestLateralWorkInputSchema.parse(input)
  const taskKind = getTaskKind(parsed.kind)
  if (
    taskKind.executionMode !== 'agent' ||
    taskKind.activation !== 'automatic' ||
    !taskKind.schedulableBy.includes('agent')
  ) {
    return fail(
      'invalid_task',
      'The registered task kind cannot be requested laterally'
    )
  }
  const payload = taskKind.briefSchema.parse(parsed.payload)
  const edge = resolveLateralWorkEdge({
    sourceWorkerKey: access.workerKey,
    targetKind: parsed.kind,
  })
  if (edge === null || edge.targetWorkerKey !== taskKind.workerKey) {
    return fail(
      'unsupported_task_kind',
      'No lateral work edge is registered for this request'
    )
  }
  if (access.sessionId !== access.rootSessionId) {
    return fail(
      'invalid_task',
      'Lateral work can only be requested from the root task session'
    )
  }
  const sourceReportObjectId = readSourceReportObjectId(payload)
  if (sourceReportObjectId === null) {
    return fail(
      'invalid_task',
      'Lateral work requires a source Content report Object'
    )
  }
  const subjectKey = taskKind.subjectKey(payload)
  const receiptOperationKey = operationKey(
    `request-lateral-work:${taskKind.kind}`,
    parsed.requestId
  )
  const semanticHash = requestHash({
    kind: parsed.kind,
    payload,
    sessionId: access.sessionId,
    startedAt: access.startedAt.toISOString(),
    taskId: access.taskId,
  })

  return await database.transaction(async (transaction) => {
    await requireTrustedAgentActor(transaction, {
      actorId: access.agentActorId,
      actorKey: access.agentActorKey,
    })
    const sourceTask = await lockRunningSourceTask({
      execution: access,
      transaction,
    })
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: createdLateralWorkReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    await requireSourceContentReport({
      brandId: access.brandId,
      sourceReportObjectId,
      sourceTaskId: access.taskId,
      transaction,
    })

    const observedTask = await observeActiveSpecialistTask(transaction, {
      brandId: access.brandId,
      kind: taskKind.kind,
      subjectKey,
    })
    if (observedTask !== null) {
      return observedLateralReceipt(observedTask.taskId)
    }

    const policy = evaluatePolicy({
      actor: { actorKey: access.agentActorKey, kind: 'agent' },
      authorization: { kind: 'autonomous' },
      capability: {
        capabilityKey: `task:${taskKind.kind}`,
        kind: 'granted',
      },
      currentBrandRestrictions: [],
      effect: { phase: taskKind.effectPhase },
      origin: {
        kind: 'accepted-intent-work',
        snapshot: {
          acceptanceCriteria: sourceTask.intentSnapshot.acceptance_criteria,
          brandId: sourceTask.intentSnapshot.brand_id,
          constraints: sourceTask.intentSnapshot.constraints,
          intentId: sourceTask.intentSnapshot.intent_id,
          intentRevision: sourceTask.intentSnapshot.intent_revision,
          preauthorizations: sourceTask.intentSnapshot.preauthorizations,
        },
      },
    })
    if (policy.verdict !== 'allowed') {
      return fail(
        'access_denied',
        `Policy denied lateral work: ${policy.reason}`
      )
    }

    const taskId = randomUUID()
    const actionId = randomUUID()
    const receipt: RequestLateralWorkReceipt = {
      actionId,
      disposition: 'created',
      outcome: 'lateral_work_requested',
      taskId,
    }
    const [insertedTask] = await transaction
      .insert(tasks)
      .values({
        activation: taskKind.activation,
        brandId: access.brandId,
        creationHash: semanticHash,
        executionMode: taskKind.executionMode,
        id: taskId,
        idempotencyKey: `task:${requestHash({
          brandId: access.brandId,
          receiptOperationKey,
        })}`,
        intentId: sourceTask.intentId,
        intentSnapshot: sourceTask.intentSnapshot,
        kind: taskKind.kind,
        parentTaskId: access.taskId,
        payload,
        payloadHash: requestHash(payload),
        status: 'queued',
        subjectKey,
        workerKey: taskKind.workerKey,
      })
      .onConflictDoNothing()
      .returning({ id: tasks.id })
    if (insertedTask === undefined) {
      const concurrentReplay = await readActionReceipt({
        brandId: access.brandId,
        operationKey: receiptOperationKey,
        receiptSchema: createdLateralWorkReceiptSchema,
        requestHash: semanticHash,
        transaction,
      })
      if (concurrentReplay !== null) {
        return concurrentReplay
      }
      const concurrentWinner = await observeActiveSpecialistTask(transaction, {
        brandId: access.brandId,
        kind: taskKind.kind,
        subjectKey,
      })
      if (concurrentWinner !== null) {
        return observedLateralReceipt(concurrentWinner.taskId)
      }
      return fail(
        'operation_conflict',
        'Lateral task creation conflicted without an observable canonical winner'
      )
    }
    await transaction.insert(actions).values({
      actorId: access.agentActorId,
      brandId: access.brandId,
      effectClass: 'graph-internal',
      id: actionId,
      intentId: sourceTask.intentId,
      operationKey: receiptOperationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale: parsed.rationale,
      requestHash: semanticHash,
      sessionId: access.sessionId,
      taskId: access.taskId,
      type: 'lateral_work_requested',
    })
    return receipt
  })
}
