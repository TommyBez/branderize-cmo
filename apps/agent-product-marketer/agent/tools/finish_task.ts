import {
  type ProductMarketerCompletion,
  productMarketerCompletionSchema,
} from '@repo/agents/tasks'
import type { TrustedTaskExecution } from '@repo/brain/context'
import { listTaskResultObjects } from '@repo/brain/task-output'
import { finishTask } from '@repo/brain/tasks'
import type { Database } from '@repo/db/client'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

import {
  requireProductMarketerRootSession,
  taskExecutionFromContext,
} from '../lib/task-runtime'

const nonBlankSchema = z.string().trim().min(1)

export const finishTaskInputSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('completed'),
      summary: nonBlankSchema.max(2000),
    })
    .strict(),
  z
    .object({
      openQuestions: z.array(nonBlankSchema.max(500)).min(1).max(3),
      reason: z.enum([
        'missing_human_context',
        'insufficient_evidence',
        'context_unavailable',
      ]),
      status: z.enum(['partial', 'blocked']),
      summary: nonBlankSchema.max(2000),
    })
    .strict(),
])

const loadProducedObjectId = async ({
  database,
  execution,
}: {
  readonly database: Database
  readonly execution: TrustedTaskExecution
}): Promise<string> => {
  const resultObjects = await listTaskResultObjects({
    database,
    execution,
  })
  const result = resultObjects.find(
    (candidate) => candidate.type === 'brand_context'
  )
  if (result === undefined) {
    throw new Error(
      'The Product Marketer task has no trusted Brand Context output'
    )
  }
  return result.id
}

const completionFromInput = async (
  input: z.infer<typeof finishTaskInputSchema>,
  execution: TrustedTaskExecution,
  database: Database
): Promise<ProductMarketerCompletion> => {
  if (input.status !== 'completed') {
    return productMarketerCompletionSchema.parse({
      intentAcceptance: null,
      openQuestions: input.openQuestions,
      outputObjectIds: [],
      result: { outcome: 'needs_input', reason: input.reason },
      status: input.status,
      summary: input.summary,
    })
  }

  const objectId = await loadProducedObjectId({
    database,
    execution,
  })
  return productMarketerCompletionSchema.parse({
    intentAcceptance: null,
    openQuestions: [],
    outputObjectIds: [objectId],
    result: { brandContextObjectId: objectId, outcome: 'report' },
    status: 'completed',
    summary: input.summary,
  })
}

export default defineTool({
  description:
    'Stage the authoritative terminal Product Marketer completion. Completed work requires a prior save_brand_context receipt; partial or blocked work records questions without writing an Object.',
  async execute(input, context) {
    requireProductMarketerRootSession(context)
    const { db } = await import('@repo/db')
    const execution = taskExecutionFromContext(context)
    const completion = await completionFromInput(input, execution, db)
    const staged = await finishTask({
      completion,
      database: db,
      execution,
    })
    return staged.completion
  },
  inputSchema: finishTaskInputSchema,
  outputSchema: productMarketerCompletionSchema,
})
