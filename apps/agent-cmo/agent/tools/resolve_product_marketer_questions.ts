import { resolveTaskQuestions } from '@repo/brain/tasks'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

import {
  loadProductMarketerQuestionTaskId,
  readCmoSessionIdentity,
  readCurrentCmoSourceTaskId,
  resolveTrustedCmoTurnAccess,
  stableCmoRequestId,
} from '../lib/runtime-access'

export const resolveProductMarketerQuestionsToolInputSchema =
  z.discriminatedUnion('disposition', [
    z
      .object({
        disposition: z.literal('answered'),
        rationale: z.string().trim().min(1).max(3000),
      })
      .strict(),
    z
      .object({
        disposition: z.literal('no_longer_relevant'),
        rationale: z.string().trim().min(1).max(3000),
      })
      .strict(),
  ])

export default defineTool({
  description:
    'Close the exact Product Marketer question bundle opened for this authenticated turn after the human addressed every question or declared the bundle no longer relevant. Supply a closed disposition and bounded rationale; task identity and questions come from trusted storage.',
  async execute(input, context) {
    const { db } = await import('@repo/db')
    const sourceTaskId = readCurrentCmoSourceTaskId(context)
    const identity = readCmoSessionIdentity(context)
    const [access, taskId] = await Promise.all([
      resolveTrustedCmoTurnAccess({ context, database: db }),
      loadProductMarketerQuestionTaskId({
        brandId: identity.brandId,
        database: db,
        sourceTaskId,
      }),
    ])
    return await resolveTaskQuestions({
      access,
      database: db,
      input: {
        disposition: input.disposition,
        rationale: input.rationale,
        requestId: stableCmoRequestId({
          context,
          operation: 'resolve-product-marketer-questions',
          semantics: {
            disposition: input.disposition,
            rationale: input.rationale,
            taskId,
          },
        }),
        taskId,
      },
    })
  },
  inputSchema: resolveProductMarketerQuestionsToolInputSchema,
})
