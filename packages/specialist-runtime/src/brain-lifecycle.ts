import type { TaskLifecyclePort } from './drain'

export const createBrainTaskLifecycle = (): TaskLifecyclePort => ({
  bindDelivery: async ({ claim, sessionId }) => {
    const [{ bindTaskSession }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    await bindTaskSession({
      database: db,
      execution: {
        agentActorId: claim.agentActorId,
        agentActorKey: claim.agentActorKey,
        brandId: claim.brandId,
        rootSessionId: sessionId,
        sessionId,
        startedAt: claim.startedAt,
        taskId: claim.taskId,
        workerKey: claim.workerKey,
      },
    })
  },
  claimNextDue: async ({ kinds, now, workerKey }) => {
    const [{ claimNextDueWorkerTask }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    return await claimNextDueWorkerTask({
      database: db,
      kinds,
      now,
      workerKey,
    })
  },
  failDelivery: async ({ claim, now }) => {
    const [{ failRegisteredAgentDelivery }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    await failRegisteredAgentDelivery({
      claim,
      database: db,
      now,
    })
  },
})
