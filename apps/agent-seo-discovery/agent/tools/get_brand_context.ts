import { readBrandContextProjection } from '@repo/brain/objects'
import { taskExecutionOf } from '@repo/specialist-runtime/session'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description:
    'Read the current Brand Context projection from the brain for this task.',
  async execute(_input, context) {
    const { db } = await import('@repo/db')
    return await readBrandContextProjection({
      database: db,
      execution: taskExecutionOf(context),
    })
  },
  inputSchema: z.object({}).strict(),
})
