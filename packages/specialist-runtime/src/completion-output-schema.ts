import { z } from 'zod'

const jsonObjectSchema = z.record(z.string(), z.json())

export const completionOutputSchemaOf = (completionSchema: z.ZodType) =>
  jsonObjectSchema.parse(z.toJSONSchema(completionSchema))
