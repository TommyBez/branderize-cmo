import { z } from 'zod'

const structureListSchema = z.array(z.json()).min(1).max(100)

export const intentStructureFields = {
  acceptanceCriteria: structureListSchema.nullable().default(null),
  constraints: structureListSchema.nullable().default(null),
} as const

export const validateIntentStructure = (
  structure: {
    readonly acceptanceCriteria: readonly unknown[] | null
    readonly constraints: readonly unknown[] | null
  },
  context: z.RefinementCtx
): void => {
  if (structure.constraints !== null && structure.acceptanceCriteria === null) {
    context.addIssue({
      code: 'custom',
      message: 'Constraints require acceptance criteria',
      path: ['constraints'],
    })
  }
}
