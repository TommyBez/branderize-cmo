import 'server-only'

import { AGENT_KEYS, type AgentKey } from '@repo/agents'
import {
  type AgentEndpointMap,
  createAgentEndpointResolver,
} from '@repo/agents/endpoints'
import { z } from 'zod'

const endpointSchema = z.url()

const readEndpoint = (value: string | undefined): string =>
  endpointSchema.parse(value)

const readEndpointMap = (): AgentEndpointMap => ({
  cmo: readEndpoint(process.env.AGENT_CMO_URL),
  content: readEndpoint(process.env.AGENT_CONTENT_URL),
  distribution: readEndpoint(process.env.AGENT_DISTRIBUTION_URL),
  growth: readEndpoint(process.env.AGENT_GROWTH_URL),
  lifecycle: readEndpoint(process.env.AGENT_LIFECYCLE_URL),
  'product-marketer': readEndpoint(process.env.AGENT_PRODUCT_MARKETER_URL),
  'seo-discovery': readEndpoint(process.env.AGENT_SEO_DISCOVERY_URL),
})

export const resolveAgentEndpoint = ({
  agentKey,
  brandId,
}: {
  readonly agentKey: AgentKey
  readonly brandId: string
}): string =>
  createAgentEndpointResolver(readEndpointMap())({ agentKey, brandId })

export const resolveFleetEndpoints = (): readonly {
  readonly agentKey: AgentKey
  readonly endpoint: string
}[] => {
  const resolver = createAgentEndpointResolver(readEndpointMap())
  return AGENT_KEYS.map((agentKey) => ({
    agentKey,
    endpoint: resolver({ agentKey, brandId: 'fleet-dispatch' }),
  }))
}
