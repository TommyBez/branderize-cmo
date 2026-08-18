import {
  getAgent,
  getTaskKind,
  type RegisteredTaskCompletionValue,
  registeredTaskKindKeySchema,
} from '@repo/agents'
import type { Database } from '@repo/db/client'
import { actions, objects, tasks } from '@repo/db/schema/domain'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { canonicalize } from './canonical'
import type { TrustedTaskExecution } from './context'
import { fail } from './errors'
import type { BrainTransaction } from './internal'
import { requireTrustedAgentActor } from './internal'
import {
  type StagedTaskCompletion,
  taskExecutionGenerationMatches,
} from './task-contracts'

const validateCompletionOutput = async ({
  completion,
  execution,
  resultActionId,
  taskKind,
  transaction,
}: {
  readonly completion: RegisteredTaskCompletionValue
  readonly execution: TrustedTaskExecution
  readonly resultActionId: string | null
  readonly taskKind: ReturnType<typeof getTaskKind>
  readonly transaction: BrainTransaction
}): Promise<void> => {
  if (completion.status !== 'completed') {
    if (resultActionId !== null) {
      return fail(
        'invalid_completion',
        'Partial or blocked completion cannot retain a task-produced Object'
      )
    }
    return
  }

  const requiredOutputIds = taskKind.requiredOutputObjectIds(completion.result)
  const missingRequiredOutput = requiredOutputIds.find(
    (outputId) => !completion.outputObjectIds.includes(outputId)
  )
  if (missingRequiredOutput !== undefined) {
    return fail(
      'invalid_output',
      'Completed task is missing its required output'
    )
  }
  if (completion.outputObjectIds.length === 0) {
    return
  }
  const outputRows = await transaction
    .select({
      actionId: actions.id,
      objectId: objects.id,
      objectType: objects.type,
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
        inArray(objects.id, [...completion.outputObjectIds]),
        eq(objects.brandId, execution.brandId),
        eq(actions.taskId, execution.taskId)
      )
    )
  const producedOutputIds = new Set(
    outputRows
      .filter(
        ({ actionId, objectType }) =>
          actionId === resultActionId &&
          taskKind.outputContract.some(
            (contractType: string) => contractType === objectType
          )
      )
      .map(({ objectId }) => objectId)
  )
  if (
    resultActionId === null ||
    completion.outputObjectIds.some(
      (outputId) => !producedOutputIds.has(outputId)
    )
  ) {
    return fail(
      'invalid_output',
      'Completed task outputs must be produced by the authoritative result Action'
    )
  }
}

export const finishTask = async ({
  completion,
  database,
  execution,
}: {
  readonly completion: RegisteredTaskCompletionValue
  readonly database: Database
  readonly execution: TrustedTaskExecution
}): Promise<StagedTaskCompletion> =>
  await database.transaction(async (transaction) => {
    const [task] = await transaction
      .select({
        completion: tasks.completion,
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
      return fail('task_not_found', 'Task completion target is missing')
    }
    const registeredKind = registeredTaskKindKeySchema.safeParse(task.kind)
    if (!registeredKind.success) {
      return fail('invalid_task', 'Task completion kind is not registered')
    }
    const taskKind = getTaskKind(registeredKind.data)
    const registeredAgent = getAgent(taskKind.workerKey)
    const bindingMatches =
      task.workerKey === execution.workerKey &&
      task.workerKey === taskKind.workerKey &&
      execution.agentActorKey === registeredAgent.actorKey &&
      taskExecutionGenerationMatches(task.startedAt, execution.startedAt) &&
      task.sessionId === execution.sessionId
    if (!bindingMatches) {
      return fail('invalid_task', 'Task completion binding is invalid')
    }
    await requireTrustedAgentActor(transaction, {
      actorId: execution.agentActorId,
      actorKey: execution.agentActorKey,
    })
    const parsedCompletion = taskKind.completionSchema.parse(completion)

    if (task.completion !== null) {
      const existing = taskKind.completionSchema.safeParse(task.completion)
      if (
        !existing.success ||
        canonicalize(existing.data) !== canonicalize(parsedCompletion)
      ) {
        return fail(
          'completion_conflict',
          'Task completion was already filled with different semantics'
        )
      }
      return {
        completion: existing.data,
        outcome: 'completion_staged',
        taskId: execution.taskId,
      }
    }
    if (task.status !== 'running') {
      return fail('task_not_running', 'Only a running task accepts completion')
    }

    await validateCompletionOutput({
      completion: parsedCompletion,
      execution,
      resultActionId: task.resultActionId,
      taskKind,
      transaction,
    })

    const [staged] = await transaction
      .update(tasks)
      .set({ completion: parsedCompletion })
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId),
          eq(tasks.kind, taskKind.kind),
          eq(tasks.workerKey, taskKind.workerKey),
          eq(tasks.status, 'running'),
          eq(tasks.sessionId, execution.sessionId),
          eq(tasks.startedAt, execution.startedAt),
          isNull(tasks.completion)
        )
      )
      .returning({ id: tasks.id })
    if (staged === undefined) {
      return fail('completion_conflict', 'Task completion lost its fill race')
    }
    return {
      completion: parsedCompletion,
      outcome: 'completion_staged',
      taskId: execution.taskId,
    }
  })
