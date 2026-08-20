// biome-ignore-all lint/performance/noAwaitInLoops: Claim, send, and bind stay serial so a send throw settles DELIVERY_FAILED and stops the drain.
import {
  type AgentKey,
  getAgent,
  getTaskKind,
  type RegisteredTaskKindKey,
} from '@repo/agents'
import type { ClaimedTask } from '@repo/brain/tasks'
import type { ChannelFrom } from 'eve/channels'

import { completionOutputSchemaOf } from './completion-output-schema'
import { createTaskSessionAuth, taskAddressOf } from './session-envelope'

const DEFAULT_DRAIN_BUDGET = 5

export interface TaskLifecyclePort {
  readonly bindDelivery: (input: {
    readonly claim: ClaimedTask
    readonly sessionId: string
  }) => Promise<void>
  readonly claimNextDue: (input: {
    readonly kinds: readonly [RegisteredTaskKindKey, ...RegisteredTaskKindKey[]]
    readonly now: Date
    readonly workerKey: AgentKey
  }) => Promise<ClaimedTask | null>
  readonly failDelivery: (input: {
    readonly claim: ClaimedTask
    readonly now: Date
  }) => Promise<void>
}

export interface TaskDrainReport {
  readonly bound: number
}

export const drainSpecialistTasks = async ({
  budget = DEFAULT_DRAIN_BUDGET,
  from,
  kinds,
  lifecycle,
  now,
  workerKey,
}: {
  readonly budget?: number
  readonly from: ChannelFrom
  readonly kinds: readonly [RegisteredTaskKindKey, ...RegisteredTaskKindKey[]]
  readonly lifecycle: TaskLifecyclePort
  readonly now: () => Date
  readonly workerKey: AgentKey
}): Promise<TaskDrainReport> => {
  if (!(Number.isInteger(budget) && budget > 0)) {
    throw new Error('Specialist drain budget must be a positive integer')
  }

  let remaining = budget
  let bound = 0
  while (remaining > 0) {
    const claim = await lifecycle.claimNextDue({
      kinds,
      now: now(),
      workerKey,
    })
    if (claim === null) {
      break
    }
    remaining -= 1

    const taskKind = getTaskKind(claim.kind)
    let sessionId: string
    try {
      const session = await from(taskAddressOf(claim)).send(
        taskKind.buildTaskPrompt({
          claimContext: claim.claimContext as never,
          intentSnapshot: claim.intentSnapshot,
          kind: claim.kind,
          payload: claim.payload,
        }),
        {
          auth: createTaskSessionAuth(claim),
          mode: 'task',
          outputSchema: completionOutputSchemaOf(taskKind.completionSchema),
          title: `${getAgent(claim.workerKey).displayName} task ${claim.taskId}`,
        }
      )
      sessionId = session.id
    } catch (error) {
      await lifecycle.failDelivery({
        claim,
        now: now(),
      })
      throw error
    }

    await lifecycle.bindDelivery({ claim, sessionId })
    bound += 1
  }

  return { bound }
}
