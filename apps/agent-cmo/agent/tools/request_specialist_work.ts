import {
  type DispatchPokeConfiguration,
  type DispatchPokeResult,
  postAgentDispatchPoke,
} from '@repo/agents/dispatch-poke'
import { normalizeAgentEndpoint } from '@repo/agents/endpoints'
import { PRODUCT_MARKETER_TASK_KIND } from '@repo/agents/tasks'
import type { RequestSpecialistWorkReceipt } from '@repo/brain/tasks'
import { requestSpecialistWork } from '@repo/brain/tasks'
import { parseCmoAgentServerEnvironment } from '@repo/env/cmo-agent-server'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

import {
  loadCmoIntentTarget,
  resolveTrustedCmoTurnAccess,
  stableCmoRequestId,
} from '../lib/runtime-access'

export const requestSpecialistWorkToolInputSchema = z.object({}).strict()

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

const readProductMarketerDispatchConfiguration =
  (): DispatchPokeConfiguration => {
    const environment = parseCmoAgentServerEnvironment(process.env)
    return {
      endpoint: normalizeAgentEndpoint(environment.AGENT_PRODUCT_MARKETER_URL),
      secret: environment.DISPATCH_SECRET,
    }
  }

export const attachImmediateProductMarketerDispatch = async ({
  poke = postAgentDispatchPoke,
  readConfiguration = readProductMarketerDispatchConfiguration,
  receipt,
}: {
  readonly poke?: (
    configuration: DispatchPokeConfiguration
  ) => Promise<DispatchPokeResult>
  readonly readConfiguration?: () => DispatchPokeConfiguration
  readonly receipt: RequestSpecialistWorkReceipt
}): Promise<RequestSpecialistWorkToolResult> => {
  if (receipt.disposition === 'already_active') {
    return { ...receipt, immediateDispatch: { outcome: 'not_needed' } }
  }

  let configuration: DispatchPokeConfiguration
  try {
    configuration = readConfiguration()
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
    "Request the allowlisted Product Marketer Brand Context task for the authenticated brand's unambiguous current-turn Intent. The task and tenant selectors are fixed by trusted runtime state.",
  async execute(_input, context) {
    const { db } = await import('@repo/db')
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
        kind: PRODUCT_MARKETER_TASK_KIND,
        payload: { purpose: 'enrich_brand_context' },
        requestId: stableCmoRequestId({
          context,
          operation: 'request-product-marketer',
          semantics: {
            kind: PRODUCT_MARKETER_TASK_KIND,
            payload: { purpose: 'enrich_brand_context' },
          },
        }),
      },
    })
    return await attachImmediateProductMarketerDispatch({ receipt })
  },
  inputSchema: requestSpecialistWorkToolInputSchema,
})
