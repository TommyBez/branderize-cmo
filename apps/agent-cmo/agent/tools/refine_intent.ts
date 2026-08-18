import { refineIntentFromCmo } from '@repo/brain/intents'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

import {
  intentStructureFields,
  validateIntentStructure,
} from '../lib/intent-tool-schema'
import {
  loadCmoRefineIntentTarget,
  resolveTrustedCmoTurnAccess,
  stableCmoRequestId,
} from '../lib/runtime-access'

export const refineIntentToolInputSchema = z
  .object(intentStructureFields)
  .strict()
  .superRefine(validateIntentStructure)

export default defineTool({
  description:
    "Refine the acceptance criteria and constraints of the authenticated brand's unambiguous current-turn Intent. The Intent identity and revision come from trusted storage.",
  async execute(input, context) {
    const { db } = await import('@repo/db')
    const requestId = stableCmoRequestId({
      context,
      operation: 'refine-intent',
      semantics: input,
    })
    const [access, target] = await Promise.all([
      resolveTrustedCmoTurnAccess({ context, database: db }),
      loadCmoRefineIntentTarget({
        context,
        database: db,
        requestId,
      }),
    ])
    return await refineIntentFromCmo({
      access,
      database: db,
      input: {
        ...input,
        expectedRevision: target.revision,
        intentId: target.id,
        requestId,
      },
    })
  },
  inputSchema: refineIntentToolInputSchema,
})
