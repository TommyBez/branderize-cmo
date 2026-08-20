// biome-ignore-all lint/performance/noAwaitInLoops: Claim and settle stay serial so a handler throw maps to unknown and stops the drain.
import {
  type AgentKey,
  getTaskKind,
  type RegisteredTaskKindKey,
} from '@repo/agents'
import type {
  ClaimedHumanCommitment,
  CommitmentOutcome,
  HumanCommitmentClaimResult,
  HumanCommitmentSettlement,
} from '@repo/brain/tasks'

const DEFAULT_DIRECT_DRAIN_BUDGET = 5

export interface DirectHumanLifecyclePort {
  readonly claimNextDue: (input: {
    readonly excludeTaskIds: readonly string[]
    readonly kinds: readonly [RegisteredTaskKindKey, ...RegisteredTaskKindKey[]]
    readonly now: Date
    readonly workerKey: AgentKey
  }) => Promise<HumanCommitmentClaimResult>
  readonly settleResult: (input: {
    readonly claim: ClaimedHumanCommitment
    readonly now: Date
    readonly outcome: CommitmentOutcome | 'unexpected_throw'
  }) => Promise<HumanCommitmentSettlement>
  readonly settleStale: (input: {
    readonly kinds: readonly [RegisteredTaskKindKey, ...RegisteredTaskKindKey[]]
    readonly now: Date
    readonly workerKey: AgentKey
  }) => Promise<readonly HumanCommitmentSettlement[]>
}

export type DirectHumanHandler = (input: {
  readonly claim: ClaimedHumanCommitment
}) => Promise<CommitmentOutcome>

export interface DirectHumanDrainReport {
  readonly claimed: number
  readonly settled: number
}

export const humanCommitmentKindsOf = (
  kinds: readonly RegisteredTaskKindKey[]
): RegisteredTaskKindKey[] =>
  kinds.filter((kind) => getTaskKind(kind).activation === 'human')

export const agentClaimableKindsOf = (
  kinds: readonly RegisteredTaskKindKey[]
): RegisteredTaskKindKey[] =>
  kinds.filter((kind) => getTaskKind(kind).executionMode === 'agent')

export const drainDirectHumanCommitments = async ({
  budget = DEFAULT_DIRECT_DRAIN_BUDGET,
  handler,
  kinds,
  lifecycle,
  now,
  workerKey,
}: {
  readonly budget?: number
  readonly handler: DirectHumanHandler
  readonly kinds: readonly [RegisteredTaskKindKey, ...RegisteredTaskKindKey[]]
  readonly lifecycle: DirectHumanLifecyclePort
  readonly now: () => Date
  readonly workerKey: AgentKey
}): Promise<DirectHumanDrainReport> => {
  if (!(Number.isInteger(budget) && budget > 0)) {
    throw new Error('Direct human drain budget must be a positive integer')
  }

  await lifecycle.settleStale({
    kinds,
    now: now(),
    workerKey,
  })

  let remaining = budget
  let claimed = 0
  let settled = 0
  const excluded: string[] = []

  while (remaining > 0) {
    const result = await lifecycle.claimNextDue({
      excludeTaskIds: excluded,
      kinds,
      now: now(),
      workerKey,
    })
    if (result.outcome === 'empty') {
      break
    }
    if (result.outcome === 'capability_missing') {
      excluded.push(result.taskId)
      continue
    }
    if (result.outcome === 'expired') {
      continue
    }

    remaining -= 1
    claimed += 1
    let outcome: CommitmentOutcome | 'unexpected_throw'
    try {
      outcome = await handler({ claim: result.claim })
    } catch {
      outcome = 'unexpected_throw'
    }
    await lifecycle.settleResult({
      claim: result.claim,
      now: now(),
      outcome,
    })
    settled += 1
  }

  return { claimed, settled }
}
