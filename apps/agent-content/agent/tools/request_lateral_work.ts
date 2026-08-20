import { lateralWorkTargetKindSchema } from '@repo/agents'
import { requestLateralWork } from '@repo/brain/tasks'
import {
  requireRootTaskSession,
  stableTaskRequestId,
  taskExecutionOf,
} from '@repo/specialist-runtime/session'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

const nonBlankSchema = z.string().trim().min(1)

export const requestLateralWorkToolInputSchema = z
  .object({
    kind: lateralWorkTargetKindSchema,
    payload: z
      .object({
        purpose: z.literal('draft_channel_plan'),
        sourceReportObjectId: z.uuid(),
      })
      .strict(),
    rationale: nonBlankSchema.max(3000),
  })
  .strict()

export default defineTool({
  description:
    'Request Distribution channel-plan work from this running Content task using a same-brand Content report Object. The new task is parented on insert and claimed on the next cron cycle, not immediately.',
  async execute(input, context) {
    requireRootTaskSession(context)
    const { db } = await import('@repo/db')
    return await requestLateralWork({
      access: taskExecutionOf(context),
      database: db,
      input: {
        kind: input.kind,
        payload: input.payload,
        rationale: input.rationale,
        requestId: stableTaskRequestId({
          context,
          operation: 'request-lateral-work',
          semantics: {
            kind: input.kind,
            payload: input.payload,
          },
        }),
      },
    })
  },
  inputSchema: requestLateralWorkToolInputSchema,
})
