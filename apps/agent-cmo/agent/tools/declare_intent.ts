import { declareIntentFromCmo } from '@repo/brain/intents'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

import {
  intentStructureFields,
  validateIntentStructure,
} from '../lib/intent-tool-schema'
import {
  resolveTrustedCmoTurnAccess,
  stableCmoRequestId,
} from '../lib/runtime-access'

export const declareIntentToolInputSchema = z
  .object({
    ...intentStructureFields,
    statement: z.string().trim().min(1).max(4000),
  })
  .strict()
  .superRefine(validateIntentStructure)

export default defineTool({
  description:
    'Declare a new canonical root Intent for the authenticated brand. Use only after the human has explicitly stated a new objective.',
  async execute(input, context) {
    const { db } = await import('@repo/db')
    const access = await resolveTrustedCmoTurnAccess({ context, database: db })
    return await declareIntentFromCmo({
      access,
      database: db,
      input: {
        ...input,
        requestId: stableCmoRequestId({
          context,
          operation: 'declare-intent',
          semantics: input,
        }),
      },
    })
  },
  inputSchema: declareIntentToolInputSchema,
})
