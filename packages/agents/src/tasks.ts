import { z } from 'zod'

const identifierSchema = z.string().trim().min(1)
const summarySchema = z.string().trim().min(1).max(2000)
const questionSchema = z.string().trim().min(1).max(500)

export const productMarketerPayloadSchema = z
  .object({
    purpose: z.literal('enrich_brand_context'),
  })
  .strict()

export const productMarketerResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      brandContextObjectId: identifierSchema,
      outcome: z.literal('report'),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('needs_input'),
      reason: z.enum([
        'missing_human_context',
        'insufficient_evidence',
        'context_unavailable',
      ]),
    })
    .strict(),
])

const completedProductMarketerCompletionSchema = z
  .object({
    intentAcceptance: z.null(),
    openQuestions: z.array(questionSchema).length(0),
    outputObjectIds: z.array(identifierSchema).length(1),
    result: z
      .object({
        brandContextObjectId: identifierSchema,
        outcome: z.literal('report'),
      })
      .strict(),
    status: z.literal('completed'),
    summary: summarySchema,
  })
  .strict()
  .superRefine((completion, context) => {
    if (
      completion.outputObjectIds[0] !== completion.result.brandContextObjectId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The required Brand Context must be the selected output',
        path: ['outputObjectIds'],
      })
    }
  })

const incompleteProductMarketerCompletionSchema = z
  .object({
    intentAcceptance: z.null(),
    openQuestions: z.array(questionSchema).min(1).max(3),
    outputObjectIds: z.array(identifierSchema).length(0),
    result: z
      .object({
        outcome: z.literal('needs_input'),
        reason: z.enum([
          'missing_human_context',
          'insufficient_evidence',
          'context_unavailable',
        ]),
      })
      .strict(),
    status: z.enum(['partial', 'blocked']),
    summary: summarySchema,
  })
  .strict()

export const productMarketerCompletionSchema = z.union([
  completedProductMarketerCompletionSchema,
  incompleteProductMarketerCompletionSchema,
])

export type ProductMarketerPayload = z.infer<
  typeof productMarketerPayloadSchema
>
export type ProductMarketerResult = z.infer<typeof productMarketerResultSchema>
export type ProductMarketerCompletion = z.infer<
  typeof productMarketerCompletionSchema
>

export const requiredProductMarketerOutputIds = (
  result: ProductMarketerResult
): readonly string[] =>
  result.outcome === 'report' ? [result.brandContextObjectId] : []
