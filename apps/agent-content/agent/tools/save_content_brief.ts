import {
  contentBriefContentSchema,
  produceContentBrief,
} from '@repo/brain/objects'
import {
  stableTaskRequestId,
  taskExecutionOf,
} from '@repo/specialist-runtime/session'
import { defineTool } from 'eve/tools'

export default defineTool({
  description:
    'Persist the completed Content brief through the canonical graph writer. Use once, only when the evidence supports a completed result.',
  async execute(content, context) {
    const { db } = await import('@repo/db')
    return await produceContentBrief({
      content,
      database: db,
      execution: taskExecutionOf(context),
      requestId: stableTaskRequestId({
        context,
        operation: 'save-content-brief',
        semantics: content,
      }),
    })
  },
  inputSchema: contentBriefContentSchema,
})
