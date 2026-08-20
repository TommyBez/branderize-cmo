import type { DirectHumanLifecyclePort } from './direct-drain'

export const createBrainHumanLifecycle = (): DirectHumanLifecyclePort => ({
  claimNextDue: async ({ excludeTaskIds, kinds, now, workerKey }) => {
    const [{ claimNextDueHumanCommitment }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    return await claimNextDueHumanCommitment({
      database: db,
      excludeTaskIds,
      kinds,
      now,
      workerKey,
    })
  },
  settleResult: async ({ claim, now, outcome }) => {
    const [{ settleHumanCommitmentResult }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    return await settleHumanCommitmentResult({
      claim,
      database: db,
      now,
      outcome,
    })
  },
  settleStale: async ({ kinds, now, workerKey }) => {
    const [{ settleStaleHumanCommitments }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    return await settleStaleHumanCommitments({
      database: db,
      kinds,
      now,
      workerKey,
    })
  },
})
