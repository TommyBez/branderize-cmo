import {
  produceProductMarketerContext,
  productMarketerContextContentSchema,
} from '@repo/brain/objects'
import { defineTool } from 'eve/tools'

import {
  readProductMarketerSessionIdentity,
  stableTaskRequestId,
  taskExecutionFromContext,
} from '../lib/task-runtime'

export default defineTool({
  description:
    'Persist the completed Product Marketer Brand Context through the canonical graph writer. Use once, only when the evidence supports a completed result.',
  async execute(content, context) {
    const identity = readProductMarketerSessionIdentity(context)
    const { db } = await import('@repo/db')
    return await produceProductMarketerContext({
      content,
      database: db,
      execution: taskExecutionFromContext(context),
      expectedBrandContextObjectId: identity.brandContextObjectId,
      requestId: stableTaskRequestId({
        context,
        operation: 'save-brand-context',
        semantics: content,
      }),
    })
  },
  inputSchema: productMarketerContextContentSchema,
})
