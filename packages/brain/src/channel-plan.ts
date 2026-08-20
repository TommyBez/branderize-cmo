import {
  DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
  DISTRIBUTION_WORKER_KEY,
} from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import { z } from 'zod'

import type { TrustedTaskExecution } from './context'
import {
  produceSpecialistObject,
  type SpecialistObjectReceipt,
} from './specialist-object'

const nonBlankSchema = z.string().trim().min(1)

export const channelPlanContentSchema = z
  .object({
    channels: z
      .array(
        z
          .object({
            name: nonBlankSchema.max(120),
            purpose: nonBlankSchema.max(500),
          })
          .strict()
      )
      .min(1)
      .max(12),
    sequence: z.array(nonBlankSchema.max(300)).min(1).max(24),
    summary: nonBlankSchema.max(3000),
  })
  .strict()

export type ChannelPlanContent = z.infer<typeof channelPlanContentSchema>
export type ChannelPlanObjectReceipt = SpecialistObjectReceipt & {
  readonly outcome: 'channel_plan_drafted'
}

export const produceChannelPlan = async ({
  content,
  database,
  execution,
  requestId,
}: {
  readonly content: ChannelPlanContent
  readonly database: Database
  readonly execution: TrustedTaskExecution
  readonly requestId: string
}): Promise<ChannelPlanObjectReceipt> => {
  const receipt = await produceSpecialistObject({
    actionType: 'channel_plan_drafted',
    content,
    contentSchema: channelPlanContentSchema,
    database,
    execution,
    expectedKind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
    expectedWorkerKey: DISTRIBUTION_WORKER_KEY,
    objectType: 'report',
    outcome: 'channel_plan_drafted',
    rationale: 'Draft the channel plan for the accepted Intent snapshot',
    requestId,
  })
  return { ...receipt, outcome: 'channel_plan_drafted' }
}
