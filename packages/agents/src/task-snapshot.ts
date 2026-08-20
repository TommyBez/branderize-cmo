import { z } from 'zod'

const nonBlankSchema = z.string().trim().min(1)

export const taskIntentSnapshotSchema = z
  .object({
    acceptance_criteria: z.array(z.json()).min(1).nullable(),
    brand_id: z.uuid(),
    constraints: z.array(z.json()).min(1).nullable(),
    intent_id: z.uuid(),
    intent_revision: z.number().int().positive(),
    preauthorizations: z.array(
      z
        .object({
          authorizedIntentRevision: z.number().int().positive(),
          decisionId: nonBlankSchema,
        })
        .strict()
    ),
    statement: nonBlankSchema,
  })
  .strict()

export type TaskIntentSnapshot = z.infer<typeof taskIntentSnapshotSchema>
