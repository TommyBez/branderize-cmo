import {
  channelPlanContentSchema,
  produceChannelPlan,
} from '@repo/brain/objects'
import {
  stableTaskRequestId,
  taskExecutionOf,
} from '@repo/specialist-runtime/session'
import { defineTool } from 'eve/tools'

export default defineTool({
  description:
    'Persist the completed channel plan through the canonical graph writer. Use once, only when the evidence supports a completed result.',
  async execute(content, context) {
    const { db } = await import('@repo/db')
    return await produceChannelPlan({
      content,
      database: db,
      execution: taskExecutionOf(context),
      requestId: stableTaskRequestId({
        context,
        operation: 'save-channel-plan',
        semantics: content,
      }),
    })
  },
  inputSchema: channelPlanContentSchema,
})
