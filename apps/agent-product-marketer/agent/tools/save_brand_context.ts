import {
  produceProductMarketerContext,
  productMarketerContextContentSchema,
} from '@repo/brain/objects'
import {
  readTaskSession,
  stableTaskRequestId,
  taskExecutionOf,
} from '@repo/specialist-runtime/session'
import { defineTool } from 'eve/tools'

export default defineTool({
  description:
    'Persist the completed Product Marketer Brand Context through the canonical graph writer. Use once, only when the evidence supports a completed result.',
  async execute(content, context) {
    const session = readTaskSession(context)
    const { db } = await import('@repo/db')
    return await produceProductMarketerContext({
      content,
      database: db,
      execution: taskExecutionOf(context),
      expectedBrandContextObjectId: session.claimContext.brandContextObjectId,
      requestId: stableTaskRequestId({
        context,
        operation: 'save-brand-context',
        semantics: content,
      }),
    })
  },
  inputSchema: productMarketerContextContentSchema,
})
