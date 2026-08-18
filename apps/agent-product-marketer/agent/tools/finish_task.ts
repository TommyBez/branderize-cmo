// biome-ignore-all lint/style/useFilenamingConvention: Eve derives the public tool name from this filename.
import {
  type ProductMarketerCompletion,
  productMarketerCompletionSchema,
} from '@repo/agents/tasks'
import { finishTask } from '@repo/brain/tasks'
import type { Database } from '@repo/db/client'
import { objects, tasks } from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

import {
  readProductMarketerSessionIdentity,
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
  brandId,
  database,
  sessionId,
  startedAt,
  taskId,
}: {
  readonly brandId: string
  readonly database: Database
  readonly sessionId: string
  readonly startedAt: Date
  readonly taskId: string
}): Promise<string> => {
  const [result] = await database
    .select({ objectId: objects.id })
    .from(tasks)
    .innerJoin(
      objects,
      and(
        eq(objects.brandId, tasks.brandId),
        eq(objects.producedBy, tasks.resultActionId),
        eq(objects.type, 'brand_context')
      )
    )
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.brandId, brandId),
        eq(tasks.sessionId, sessionId),
        eq(tasks.startedAt, startedAt),
        eq(tasks.status, 'running')
      )
    )
    .limit(1)
  if (result === undefined) {
    throw new Error(
      'The Product Marketer task has no trusted Brand Context output'
    )
  }
  return result.objectId
}

const completionFromInput = async (
  input: z.infer<typeof finishTaskInputSchema>,
  identity: ReturnType<typeof readProductMarketerSessionIdentity>,
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
    brandId: identity.brandId,
    database,
    sessionId: identity.sessionId,
    startedAt: identity.startedAt,
    taskId: identity.taskId,
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
    const identity = readProductMarketerSessionIdentity(context)
    const { db } = await import('@repo/db')
    const completion = await completionFromInput(input, identity, db)
    const staged = await finishTask({
      completion,
      database: db,
      execution: taskExecutionFromContext(context),
    })
    return staged.completion
  },
  inputSchema: finishTaskInputSchema,
  outputSchema: productMarketerCompletionSchema,
})
