import { CONTENT_BRIEF_TASK_KIND, CONTENT_WORKER_KEY } from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import { z } from 'zod'

import type { TrustedTaskExecution } from './context'
import {
  produceSpecialistObject,
  type SpecialistObjectReceipt,
} from './specialist-object'

const nonBlankSchema = z.string().trim().min(1)

export const contentBriefContentSchema = z
  .object({
    audience: nonBlankSchema.max(300),
    channels: z.array(nonBlankSchema.max(120)).min(1).max(12),
    outline: z.array(nonBlankSchema.max(500)).min(1).max(24),
    summary: nonBlankSchema.max(3000),
    title: nonBlankSchema.max(200),
  })
  .strict()

export type ContentBriefContent = z.infer<typeof contentBriefContentSchema>
export type ContentBriefObjectReceipt = SpecialistObjectReceipt & {
  readonly outcome: 'content_brief_drafted'
}

export const produceContentBrief = async ({
  content,
  database,
  execution,
  requestId,
}: {
  readonly content: ContentBriefContent
  readonly database: Database
  readonly execution: TrustedTaskExecution
  readonly requestId: string
}): Promise<ContentBriefObjectReceipt> => {
  const receipt = await produceSpecialistObject({
    actionType: 'content_brief_drafted',
    content,
    contentSchema: contentBriefContentSchema,
    database,
    execution,
    expectedKind: CONTENT_BRIEF_TASK_KIND,
    expectedWorkerKey: CONTENT_WORKER_KEY,
    objectType: 'report',
    outcome: 'content_brief_drafted',
    rationale: 'Draft the Content brief for the accepted Intent snapshot',
    requestId,
  })
  return { ...receipt, outcome: 'content_brief_drafted' }
}
