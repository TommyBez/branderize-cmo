import { randomUUID } from 'node:crypto'

import type { AgentKey, RegisteredTaskKindKey } from '@repo/agents'
import type { Database } from '@repo/db/client'
import { actions, objects, tasks } from '@repo/db/schema/domain'
import { evaluatePolicy } from '@repo/policy'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { canonicalize, operationKey, requestHash } from './canonical'
import type { TrustedTaskExecution } from './context'
import { fail } from './errors'
import { requireTrustedAgentActor } from './internal'
import { readActionReceipt } from './receipts'

const identifierSchema = z.string().trim().min(1)
const intentSnapshotSchema = z
  .object({
    acceptance_criteria: z.array(z.json()).min(1).nullable(),
    brand_id: z.uuid(),
    constraints: z.array(z.json()).min(1).nullable(),
    intent_id: z.uuid(),
    intent_revision: z.number().int().positive(),
    preauthorizations: z.array(
      z
        .object({
          authorizedIntentRevision: z.number().int().positive(),
          decisionId: identifierSchema,
        })
        .strict()
    ),
    statement: identifierSchema,
  })
  .strict()

export type SpecialistObjectType = 'evidence' | 'report'

export interface SpecialistObjectReceipt {
  readonly actionId: string
  readonly objectId: string
  readonly outcome: string
  readonly taskId: string
}

const hasSpecialistBinding = ({
  expectedKind,
  expectedWorkerKey,
  execution,
  task,
}: {
  readonly expectedKind: RegisteredTaskKindKey
  readonly expectedWorkerKey: AgentKey
  readonly execution: TrustedTaskExecution
  readonly task: {
    readonly brandId: string
    readonly kind: string
    readonly sessionId: string | null
    readonly startedAt: Date | null
    readonly workerKey: string
  }
}): boolean =>
  task.brandId === execution.brandId &&
  task.kind === expectedKind &&
  task.workerKey === expectedWorkerKey &&
  execution.workerKey === expectedWorkerKey &&
  task.startedAt !== null &&
  task.startedAt.getTime() === execution.startedAt.getTime() &&
  task.sessionId === execution.rootSessionId

export const produceSpecialistObject = async <TContent>({
  actionType,
  content,
  contentSchema,
  database,
  execution,
  expectedKind,
  expectedWorkerKey,
  objectType,
  outcome,
  rationale,
  requestId,
}: {
  readonly actionType: string
  readonly content: TContent
  readonly contentSchema: z.ZodType<TContent>
  readonly database: Database
  readonly execution: TrustedTaskExecution
  readonly expectedKind: RegisteredTaskKindKey
  readonly expectedWorkerKey: AgentKey
  readonly objectType: SpecialistObjectType
  readonly outcome: string
  readonly rationale: string
  readonly requestId: string
}): Promise<SpecialistObjectReceipt> => {
  const parsedContent = contentSchema.parse(content)
  const parsedRequestId = identifierSchema.max(500).parse(requestId)
  const receiptOperationKey = operationKey(
    `${expectedWorkerKey}-output:${execution.taskId}`,
    parsedRequestId
  )
  const semanticHash = requestHash({
    content: parsedContent,
    objectType,
    sessionId: execution.sessionId,
    startedAt: execution.startedAt.toISOString(),
    taskId: execution.taskId,
  })
  const receiptSchema = z
    .object({
      actionId: z.uuid(),
      objectId: z.uuid(),
      outcome: z.literal(outcome),
      taskId: z.uuid(),
    })
    .strict()

  return await database.transaction(async (transaction) => {
    await requireTrustedAgentActor(transaction, {
      actorId: execution.agentActorId,
      actorKey: execution.agentActorKey,
    })
    const [task] = await transaction
      .select({
        brandId: tasks.brandId,
        completion: tasks.completion,
        intentId: tasks.intentId,
        intentSnapshot: tasks.intentSnapshot,
        kind: tasks.kind,
        resultActionId: tasks.resultActionId,
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
        status: tasks.status,
        workerKey: tasks.workerKey,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId)
        )
      )
      .for('update')
      .limit(1)
    if (task === undefined) {
      return fail('task_not_found', 'Specialist task does not exist')
    }
    if (
      !hasSpecialistBinding({
        execution,
        expectedKind,
        expectedWorkerKey,
        task,
      })
    ) {
      return fail('invalid_task', 'Specialist task binding is invalid')
    }

    const replay = await readActionReceipt({
      brandId: execution.brandId,
      operationKey: receiptOperationKey,
      receiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    if (
      task.status !== 'running' ||
      task.completion !== null ||
      task.resultActionId !== null
    ) {
      return fail(
        'task_not_running',
        'Task cannot accept a new canonical output'
      )
    }
    const intentSnapshot = intentSnapshotSchema.safeParse(task.intentSnapshot)
    if (
      !intentSnapshot.success ||
      task.intentId !== intentSnapshot.data.intent_id ||
      intentSnapshot.data.brand_id !== execution.brandId
    ) {
      return fail('invalid_task', 'Task Intent snapshot is invalid')
    }

    const policy = evaluatePolicy({
      actor: { actorKey: execution.agentActorKey, kind: 'agent' },
      authorization: { kind: 'autonomous' },
      capability: {
        capabilityKey: `task:${expectedKind}`,
        kind: 'granted',
      },
      currentBrandRestrictions: [],
      effect: { phase: 'graph-internal' },
      origin: {
        kind: 'accepted-intent-work',
        snapshot: {
          acceptanceCriteria: intentSnapshot.data.acceptance_criteria,
          brandId: intentSnapshot.data.brand_id,
          constraints: intentSnapshot.data.constraints,
          intentId: intentSnapshot.data.intent_id,
          intentRevision: intentSnapshot.data.intent_revision,
          preauthorizations: intentSnapshot.data.preauthorizations,
        },
      },
    })
    if (policy.verdict !== 'allowed') {
      return fail(
        'access_denied',
        `Policy denied specialist output: ${policy.reason}`
      )
    }

    const actionId = randomUUID()
    const objectId = randomUUID()
    const receipt: SpecialistObjectReceipt = {
      actionId,
      objectId,
      outcome,
      taskId: execution.taskId,
    }
    await transaction.insert(actions).values({
      actorId: execution.agentActorId,
      brandId: execution.brandId,
      effectClass: 'graph-internal',
      id: actionId,
      intentId: task.intentId,
      operationKey: receiptOperationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale,
      requestHash: semanticHash,
      sessionId: execution.sessionId,
      taskId: execution.taskId,
      type: actionType,
    })
    const nextContent = {
      source: expectedWorkerKey,
      taskId: execution.taskId,
      [objectType]: parsedContent,
    }
    await transaction.insert(objects).values({
      brandId: execution.brandId,
      content: nextContent,
      contentText: canonicalize(nextContent),
      id: objectId,
      producedBy: actionId,
      status: 'active',
      type: objectType,
    })
    const [boundTask] = await transaction
      .update(tasks)
      .set({ resultActionId: actionId })
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId),
          eq(tasks.status, 'running'),
          eq(tasks.startedAt, execution.startedAt),
          isNull(tasks.resultActionId)
        )
      )
      .returning({ id: tasks.id })
    if (boundTask === undefined) {
      return fail('invalid_task', 'Task output Action binding lost its race')
    }
    return receipt
  })
}
