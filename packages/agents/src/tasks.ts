import { z } from 'zod'

import type { TaskIntentSnapshot } from './task-snapshot'

export const PRODUCT_MARKETER_TASK_KIND =
  'product-marketer.brand-context.v1' as const
export const PRODUCT_MARKETER_WORKER_KEY = 'product-marketer' as const
export const CONTENT_BRIEF_TASK_KIND = 'content.brief.v1' as const
export const CONTENT_WORKER_KEY = 'content' as const
export const DISTRIBUTION_CHANNEL_PLAN_TASK_KIND =
  'distribution.channel-plan.v1' as const
export const DISTRIBUTION_WORKER_KEY = 'distribution' as const
export const SEO_DISCOVERY_OPPORTUNITY_TASK_KIND =
  'seo-discovery.opportunity.v1' as const
export const SEO_DISCOVERY_WORKER_KEY = 'seo-discovery' as const

const identifierSchema = z.string().trim().min(1)
const summarySchema = z.string().trim().min(1).max(2000)
const questionSchema = z.string().trim().min(1).max(500)
const needsInputReasonSchema = z.enum([
  'missing_human_context',
  'insufficient_evidence',
  'context_unavailable',
])

const needsInputResultSchema = z
  .object({
    outcome: z.literal('needs_input'),
    reason: needsInputReasonSchema,
  })
  .strict()

export const brandContextClaimContextSchema = z
  .object({
    brandContextContent: z.unknown(),
    brandContextObjectId: identifierSchema,
  })
  .strict()

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
  needsInputResultSchema,
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

const incompleteSpecialistCompletionSchema = z
  .object({
    intentAcceptance: z.null(),
    openQuestions: z.array(questionSchema).min(1).max(3),
    outputObjectIds: z.array(identifierSchema).length(0),
    result: needsInputResultSchema,
    status: z.enum(['partial', 'blocked']),
    summary: summarySchema,
  })
  .strict()

export const productMarketerCompletionSchema = z.union([
  completedProductMarketerCompletionSchema,
  incompleteSpecialistCompletionSchema,
])

export const productMarketerClaimContextSchema = brandContextClaimContextSchema

const reportObjectResultSchema = z
  .object({
    outcome: z.literal('report'),
    reportObjectId: identifierSchema,
  })
  .strict()
const evidenceObjectResultSchema = z
  .object({
    evidenceObjectId: identifierSchema,
    outcome: z.literal('report'),
  })
  .strict()

const completedReportObjectCompletionSchema = z
  .object({
    intentAcceptance: z.null(),
    openQuestions: z.array(questionSchema).length(0),
    outputObjectIds: z.array(identifierSchema).length(1),
    result: reportObjectResultSchema,
    status: z.literal('completed'),
    summary: summarySchema,
  })
  .strict()
  .superRefine((completion, context) => {
    if (completion.outputObjectIds[0] !== completion.result.reportObjectId) {
      context.addIssue({
        code: 'custom',
        message: 'The required report must be the selected output',
        path: ['outputObjectIds'],
      })
    }
  })

const completedEvidenceObjectCompletionSchema = z
  .object({
    intentAcceptance: z.null(),
    openQuestions: z.array(questionSchema).length(0),
    outputObjectIds: z.array(identifierSchema).length(1),
    result: evidenceObjectResultSchema,
    status: z.literal('completed'),
    summary: summarySchema,
  })
  .strict()
  .superRefine((completion, context) => {
    if (completion.outputObjectIds[0] !== completion.result.evidenceObjectId) {
      context.addIssue({
        code: 'custom',
        message: 'The required SEO opportunity must be the selected output',
        path: ['outputObjectIds'],
      })
    }
  })

export const contentBriefPayloadSchema = z
  .object({
    purpose: z.literal('draft_content_brief'),
  })
  .strict()
export const contentBriefResultSchema = z.discriminatedUnion('outcome', [
  reportObjectResultSchema,
  needsInputResultSchema,
])
export const contentBriefCompletionSchema = z.union([
  completedReportObjectCompletionSchema,
  incompleteSpecialistCompletionSchema,
])
export const contentBriefClaimContextSchema = brandContextClaimContextSchema

export const distributionChannelPlanPayloadSchema = z
  .object({
    purpose: z.literal('draft_channel_plan'),
  })
  .strict()
export const distributionChannelPlanResultSchema = z.discriminatedUnion(
  'outcome',
  [reportObjectResultSchema, needsInputResultSchema]
)
export const distributionChannelPlanCompletionSchema = z.union([
  completedReportObjectCompletionSchema,
  incompleteSpecialistCompletionSchema,
])
export const distributionChannelPlanClaimContextSchema =
  brandContextClaimContextSchema

export const seoDiscoveryOpportunityPayloadSchema = z
  .object({
    purpose: z.literal('draft_seo_opportunity'),
  })
  .strict()
export const seoDiscoveryOpportunityResultSchema = z.discriminatedUnion(
  'outcome',
  [evidenceObjectResultSchema, needsInputResultSchema]
)
export const seoDiscoveryOpportunityCompletionSchema = z.union([
  completedEvidenceObjectCompletionSchema,
  incompleteSpecialistCompletionSchema,
])
export const seoDiscoveryOpportunityClaimContextSchema =
  brandContextClaimContextSchema

export type ProductMarketerPayload = z.infer<
  typeof productMarketerPayloadSchema
>
export type ProductMarketerResult = z.infer<typeof productMarketerResultSchema>
export type ProductMarketerCompletion = z.infer<
  typeof productMarketerCompletionSchema
>
export type ProductMarketerClaimContext = z.infer<
  typeof productMarketerClaimContextSchema
>
export type ContentBriefPayload = z.infer<typeof contentBriefPayloadSchema>
export type ContentBriefResult = z.infer<typeof contentBriefResultSchema>
export type ContentBriefCompletion = z.infer<
  typeof contentBriefCompletionSchema
>
export type ContentBriefClaimContext = z.infer<
  typeof contentBriefClaimContextSchema
>
export type DistributionChannelPlanPayload = z.infer<
  typeof distributionChannelPlanPayloadSchema
>
export type DistributionChannelPlanResult = z.infer<
  typeof distributionChannelPlanResultSchema
>
export type DistributionChannelPlanCompletion = z.infer<
  typeof distributionChannelPlanCompletionSchema
>
export type DistributionChannelPlanClaimContext = z.infer<
  typeof distributionChannelPlanClaimContextSchema
>
export type SeoDiscoveryOpportunityPayload = z.infer<
  typeof seoDiscoveryOpportunityPayloadSchema
>
export type SeoDiscoveryOpportunityResult = z.infer<
  typeof seoDiscoveryOpportunityResultSchema
>
export type SeoDiscoveryOpportunityCompletion = z.infer<
  typeof seoDiscoveryOpportunityCompletionSchema
>
export type SeoDiscoveryOpportunityClaimContext = z.infer<
  typeof seoDiscoveryOpportunityClaimContextSchema
>

const buildKindTaskPrompt = ({
  claimContext,
  intentSnapshot,
  kind,
  payload,
  role,
  saveTool,
}: {
  readonly claimContext: ProductMarketerClaimContext
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: string
  readonly payload: unknown
  readonly role: string
  readonly saveTool: string
}): string =>
  [
    `Execute the trusted ${role} task below.`,
    'Use only the supplied immutable Intent snapshot and current Brand Context.',
    `For completed work, call ${saveTool} and then finish_task.`,
    'For partial or blocked work, do not write an Object; call finish_task with up to three precise questions.',
    'Return the same registered completion shape after the trusted tool confirms it.',
    JSON.stringify({
      currentBrandContext: claimContext.brandContextContent,
      intentSnapshot,
      payload,
      taskKind: kind,
    }),
  ].join('\n\n')

export const buildProductMarketerTaskPrompt = ({
  claimContext,
  intentSnapshot,
  kind,
  payload,
}: {
  readonly claimContext: ProductMarketerClaimContext
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: string
  readonly payload: unknown
}): string =>
  buildKindTaskPrompt({
    claimContext,
    intentSnapshot,
    kind,
    payload,
    role: 'Product Marketer Brand Context',
    saveTool: 'save_brand_context',
  })

export const buildContentBriefTaskPrompt = ({
  claimContext,
  intentSnapshot,
  kind,
  payload,
}: {
  readonly claimContext: ContentBriefClaimContext
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: string
  readonly payload: unknown
}): string =>
  buildKindTaskPrompt({
    claimContext,
    intentSnapshot,
    kind,
    payload,
    role: 'Content brief',
    saveTool: 'save_content_brief',
  })

export const buildDistributionChannelPlanTaskPrompt = ({
  claimContext,
  intentSnapshot,
  kind,
  payload,
}: {
  readonly claimContext: DistributionChannelPlanClaimContext
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: string
  readonly payload: unknown
}): string =>
  buildKindTaskPrompt({
    claimContext,
    intentSnapshot,
    kind,
    payload,
    role: 'Distribution channel plan',
    saveTool: 'save_channel_plan',
  })

export const buildSeoDiscoveryOpportunityTaskPrompt = ({
  claimContext,
  intentSnapshot,
  kind,
  payload,
}: {
  readonly claimContext: SeoDiscoveryOpportunityClaimContext
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: string
  readonly payload: unknown
}): string =>
  buildKindTaskPrompt({
    claimContext,
    intentSnapshot,
    kind,
    payload,
    role: 'SEO Discovery opportunity',
    saveTool: 'save_seo_opportunity',
  })

export const requiredProductMarketerOutputIds = (
  result: ProductMarketerResult
): readonly string[] =>
  result.outcome === 'report' ? [result.brandContextObjectId] : []

export const requiredContentBriefOutputIds = (
  result: ContentBriefResult
): readonly string[] =>
  result.outcome === 'report' ? [result.reportObjectId] : []

export const requiredDistributionChannelPlanOutputIds = (
  result: DistributionChannelPlanResult
): readonly string[] =>
  result.outcome === 'report' ? [result.reportObjectId] : []

export const requiredSeoDiscoveryOpportunityOutputIds = (
  result: SeoDiscoveryOpportunityResult
): readonly string[] =>
  result.outcome === 'report' ? [result.evidenceObjectId] : []

export const hasOpenProductMarketerQuestions = (
  completion: ProductMarketerCompletion
): boolean => completion.status !== 'completed'

export const hasOpenContentBriefQuestions = (
  completion: ContentBriefCompletion
): boolean => completion.status !== 'completed'

export const hasOpenDistributionChannelPlanQuestions = (
  completion: DistributionChannelPlanCompletion
): boolean => completion.status !== 'completed'

export const hasOpenSeoDiscoveryOpportunityQuestions = (
  completion: SeoDiscoveryOpportunityCompletion
): boolean => completion.status !== 'completed'
