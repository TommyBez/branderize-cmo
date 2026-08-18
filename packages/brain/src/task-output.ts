import { getTaskKind, registeredTaskKindKeySchema } from '@repo/agents'
import type { Database } from '@repo/db/client'
import { objects, tasks } from '@repo/db/schema/domain'
import { and, eq, inArray } from 'drizzle-orm'

import type { TrustedTaskExecution } from './context'
import { fail } from './errors'
import { requireTrustedAgentActor } from './internal'

export interface TaskResultObject {
  readonly id: string
  readonly type: string
}

export const listTaskResultObjects = async ({
  database,
  execution,
}: {
  readonly database: Database
  readonly execution: TrustedTaskExecution
}): Promise<readonly TaskResultObject[]> =>
  await database.transaction(async (transaction) => {
    await requireTrustedAgentActor(transaction, {
      actorId: execution.agentActorId,
      actorKey: execution.agentActorKey,
    })
    const [task] = await transaction
      .select({
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
      .for('share')
      .limit(1)
    if (task === undefined) {
      return fail('task_not_found', 'Task output target is missing')
    }
    const registeredKind = registeredTaskKindKeySchema.safeParse(task.kind)
    if (!registeredKind.success) {
      return fail('invalid_task', 'Task output kind is not registered')
    }
    const taskKind = getTaskKind(registeredKind.data)
    const bindingMatches =
      task.workerKey === execution.workerKey &&
      task.workerKey === taskKind.workerKey &&
      task.startedAt?.getTime() === execution.startedAt.getTime() &&
      task.sessionId === execution.sessionId
    if (!bindingMatches || task.status !== 'running') {
      return fail('invalid_task', 'Task output binding is invalid')
    }
    if (task.resultActionId === null) {
      return []
    }

    return await transaction
      .select({ id: objects.id, type: objects.type })
      .from(objects)
      .where(
        and(
          eq(objects.brandId, execution.brandId),
          eq(objects.producedBy, task.resultActionId),
          inArray(objects.type, [...taskKind.outputContract])
        )
      )
      .orderBy(objects.id)
  })
