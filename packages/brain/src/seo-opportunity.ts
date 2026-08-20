import {
  SEO_DISCOVERY_OPPORTUNITY_TASK_KIND,
  SEO_DISCOVERY_WORKER_KEY,
} from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import { z } from 'zod'

import type { TrustedTaskExecution } from './context'
import {
  produceSpecialistObject,
  type SpecialistObjectReceipt,
} from './specialist-object'

const nonBlankSchema = z.string().trim().min(1)

export const seoOpportunityContentSchema = z
  .object({
    opportunity: nonBlankSchema.max(500),
    pages: z
      .array(
        z
          .object({
            path: nonBlankSchema.max(300),
            rationale: nonBlankSchema.max(500),
          })
          .strict()
      )
      .min(1)
      .max(12),
    queries: z.array(nonBlankSchema.max(200)).min(1).max(24),
    summary: nonBlankSchema.max(3000),
  })
  .strict()

export type SeoOpportunityContent = z.infer<typeof seoOpportunityContentSchema>
export type SeoOpportunityObjectReceipt = SpecialistObjectReceipt & {
  readonly outcome: 'seo_opportunity_recorded'
}

export const produceSeoOpportunity = async ({
  content,
  database,
  execution,
  requestId,
}: {
  readonly content: SeoOpportunityContent
  readonly database: Database
  readonly execution: TrustedTaskExecution
  readonly requestId: string
}): Promise<SeoOpportunityObjectReceipt> => {
  const receipt = await produceSpecialistObject({
    actionType: 'seo_opportunity_recorded',
    content,
    contentSchema: seoOpportunityContentSchema,
    database,
    execution,
    expectedKind: SEO_DISCOVERY_OPPORTUNITY_TASK_KIND,
    expectedWorkerKey: SEO_DISCOVERY_WORKER_KEY,
    objectType: 'evidence',
    outcome: 'seo_opportunity_recorded',
    rationale: 'Record the SEO opportunity for the accepted Intent snapshot',
    requestId,
  })
  return { ...receipt, outcome: 'seo_opportunity_recorded' }
}
