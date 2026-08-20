import {
  type ContentBriefCompletion,
  contentBriefCompletionSchema,
} from '@repo/agents/tasks'
import type { TrustedTaskExecution } from '@repo/brain/context'
import { listTaskResultObjects } from '@repo/brain/task-output'
import { finishTask } from '@repo/brain/tasks'
import type { Database } from '@repo/db/client'
import {
  requireRootTaskSession,
  taskExecutionOf,
} from '@repo/specialist-runtime/session'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

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
  const result = resultObjects.find((candidate) => candidate.type === 'report')
  if (result === undefined) {
    throw new Error('The Content task has no trusted brief output')
  }
  return result.id
}

const completionFromInput = async (
  input: z.infer<typeof finishTaskInputSchema>,
  execution: TrustedTaskExecution,
  database: Database
): Promise<ContentBriefCompletion> => {
  if (input.status !== 'completed') {
    return contentBriefCompletionSchema.parse({
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
  return contentBriefCompletionSchema.parse({
    intentAcceptance: null,
    openQuestions: [],
    outputObjectIds: [objectId],
    result: { outcome: 'report', reportObjectId: objectId },
    status: 'completed',
    summary: input.summary,
  })
}

export default defineTool({
  description:
    'Stage the authoritative terminal Content completion. Completed work requires a prior save_content_brief receipt; partial or blocked work records questions without writing an Object.',
  async execute(input, context) {
    requireRootTaskSession(context)
    const { db } = await import('@repo/db')
    const execution = taskExecutionOf(context)
    const completion = await completionFromInput(input, execution, db)
    const staged = await finishTask({
      completion,
      database: db,
      execution,
    })
    return staged.completion
  },
  inputSchema: finishTaskInputSchema,
  outputSchema: contentBriefCompletionSchema,
})
