import {
  type DispatchPokeConfiguration,
  type DispatchPokeResult,
  postAgentDispatchPoke,
} from '@repo/agents/dispatch-poke'
import { createPartialAgentEndpointResolver } from '@repo/agents/endpoints'
import {
  CONTENT_BRIEF_TASK_KIND,
  CONTENT_WORKER_KEY,
  DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
  DISTRIBUTION_WORKER_KEY,
  PRODUCT_MARKETER_TASK_KIND,
  PRODUCT_MARKETER_WORKER_KEY,
  SEO_DISCOVERY_OPPORTUNITY_TASK_KIND,
  SEO_DISCOVERY_WORKER_KEY,
} from '@repo/agents/tasks'
import type { RequestSpecialistWorkReceipt } from '@repo/brain/tasks'
import { requestSpecialistWork } from '@repo/brain/tasks'
import {
  type CmoAgentServerEnvironment,
  parseCmoAgentServerEnvironment,
} from '@repo/env/cmo-agent-server'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

import {
  loadCmoIntentTarget,
  resolveTrustedCmoTurnAccess,
  stableCmoRequestId,
} from '../lib/runtime-access'

export const CMO_SPECIALIST_PURPOSES = [
  'enrich_brand_context',
  'draft_content_brief',
  'draft_channel_plan',
  'draft_seo_opportunity',
] as const

export const requestSpecialistWorkToolInputSchema = z
  .object({
    purpose: z.enum(CMO_SPECIALIST_PURPOSES),
  })
  .strict()

export type CmoSpecialistPurpose = (typeof CMO_SPECIALIST_PURPOSES)[number]

const CMO_SPECIALIST_REQUESTS = {
  draft_channel_plan: {
    kind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
    operation: 'request-distribution',
    payload: { purpose: 'draft_channel_plan' },
    workerKey: DISTRIBUTION_WORKER_KEY,
  },
  draft_content_brief: {
    kind: CONTENT_BRIEF_TASK_KIND,
    operation: 'request-content',
    payload: { purpose: 'draft_content_brief' },
    workerKey: CONTENT_WORKER_KEY,
  },
  draft_seo_opportunity: {
    kind: SEO_DISCOVERY_OPPORTUNITY_TASK_KIND,
    operation: 'request-seo-discovery',
    payload: { purpose: 'draft_seo_opportunity' },
    workerKey: SEO_DISCOVERY_WORKER_KEY,
  },
  enrich_brand_context: {
    kind: PRODUCT_MARKETER_TASK_KIND,
    operation: 'request-product-marketer',
    payload: { purpose: 'enrich_brand_context' },
    workerKey: PRODUCT_MARKETER_WORKER_KEY,
  },
} as const

export type CmoSpecialistWorkerKey =
  (typeof CMO_SPECIALIST_REQUESTS)[CmoSpecialistPurpose]['workerKey']

type CreatedSpecialistWorkReceipt = Extract<
  RequestSpecialistWorkReceipt,
  { readonly disposition: 'created' }
>

type ObservedSpecialistWorkReceipt = Extract<
  RequestSpecialistWorkReceipt,
  { readonly disposition: 'already_active' }
>

export type RequestSpecialistWorkToolResult =
  | (CreatedSpecialistWorkReceipt & {
      readonly immediateDispatch: DispatchPokeResult
    })
  | (ObservedSpecialistWorkReceipt & {
      readonly immediateDispatch: { readonly outcome: 'not_needed' }
    })

export const resolveCmoSpecialistRequest = <
  TPurpose extends CmoSpecialistPurpose,
>(
  purpose: TPurpose
): (typeof CMO_SPECIALIST_REQUESTS)[TPurpose] =>
  CMO_SPECIALIST_REQUESTS[purpose]

export const resolveCmoSpecialistDispatchConfiguration = ({
  environment,
  workerKey,
}: {
  readonly environment: CmoAgentServerEnvironment
  readonly workerKey: CmoSpecialistWorkerKey
}): DispatchPokeConfiguration => {
  const resolveEndpoint = createPartialAgentEndpointResolver({
    content: environment.AGENT_CONTENT_URL,
    distribution: environment.AGENT_DISTRIBUTION_URL,
    'product-marketer': environment.AGENT_PRODUCT_MARKETER_URL,
    'seo-discovery': environment.AGENT_SEO_DISCOVERY_URL,
  })
  return {
    endpoint: resolveEndpoint({ agentKey: workerKey }),
    secret: environment.DISPATCH_SECRET,
  }
}

const readCmoSpecialistDispatchConfiguration = (
  workerKey: CmoSpecialistWorkerKey
): DispatchPokeConfiguration =>
  resolveCmoSpecialistDispatchConfiguration({
    environment: parseCmoAgentServerEnvironment(process.env),
    workerKey,
  })

export const attachImmediateSpecialistDispatch = async ({
  poke = postAgentDispatchPoke,
  readConfiguration = readCmoSpecialistDispatchConfiguration,
  receipt,
  workerKey,
}: {
  readonly poke?: (
    configuration: DispatchPokeConfiguration
  ) => Promise<DispatchPokeResult>
  readonly readConfiguration?: (
    workerKey: CmoSpecialistWorkerKey
  ) => DispatchPokeConfiguration
  readonly receipt: RequestSpecialistWorkReceipt
  readonly workerKey: CmoSpecialistWorkerKey
}): Promise<RequestSpecialistWorkToolResult> => {
  if (receipt.disposition === 'already_active') {
    return { ...receipt, immediateDispatch: { outcome: 'not_needed' } }
  }

  let configuration: DispatchPokeConfiguration
  try {
    configuration = readConfiguration(workerKey)
  } catch {
    return {
      ...receipt,
      immediateDispatch: {
        outcome: 'deferred',
        reason: 'configuration_unavailable',
      },
    }
  }

  try {
    return {
      ...receipt,
      immediateDispatch: await poke(configuration),
    }
  } catch {
    return {
      ...receipt,
      immediateDispatch: {
        outcome: 'deferred',
        reason: 'request_failed',
      },
    }
  }
}

export default defineTool({
  description:
    "Request allowlisted specialist work for the authenticated brand's unambiguous current-turn Intent. Choose a purpose; the task, payload, and worker are fixed by trusted runtime state.",
  async execute(input, context) {
    const { db } = await import('@repo/db')
    const request = resolveCmoSpecialistRequest(input.purpose)
    const access = await resolveTrustedCmoTurnAccess({
      context,
      database: db,
    })
    const target = await loadCmoIntentTarget({ access, database: db })
    const receipt = await requestSpecialistWork({
      access,
      database: db,
      input: {
        intentId: target.id,
        kind: request.kind,
        payload: request.payload,
        requestId: stableCmoRequestId({
          context,
          operation: request.operation,
          semantics: {
            kind: request.kind,
            payload: request.payload,
          },
        }),
      },
    })
    return await attachImmediateSpecialistDispatch({
      receipt,
      workerKey: request.workerKey,
    })
  },
  inputSchema: requestSpecialistWorkToolInputSchema,
})
