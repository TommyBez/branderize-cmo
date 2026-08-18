import { z } from 'zod'

import { AGENT_KEYS, type AgentKey } from './registry'

const TRAILING_SLASH_PATTERN = /\/$/u

const endpointLookupSchema = z
  .object({
    agentKey: z.enum(AGENT_KEYS),
  })
  .strict()

export type AgentEndpointMap = Readonly<Record<AgentKey, string>>

export const normalizeAgentEndpoint = (endpoint: string): string => {
  const parsed = new URL(endpoint)
  const isLocalDevelopment =
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')

  if (parsed.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('Agent endpoints must use HTTPS outside local development')
  }

  parsed.hash = ''
  parsed.search = ''
  return parsed.href.replace(TRAILING_SLASH_PATTERN, '')
}

export const createAgentEndpointResolver = (endpoints: AgentEndpointMap) => {
  const compiledEndpoints = {
    cmo: normalizeAgentEndpoint(endpoints.cmo),
    content: normalizeAgentEndpoint(endpoints.content),
    distribution: normalizeAgentEndpoint(endpoints.distribution),
    growth: normalizeAgentEndpoint(endpoints.growth),
    lifecycle: normalizeAgentEndpoint(endpoints.lifecycle),
    'product-marketer': normalizeAgentEndpoint(endpoints['product-marketer']),
    'seo-discovery': normalizeAgentEndpoint(endpoints['seo-discovery']),
  } satisfies AgentEndpointMap

  return (input: unknown): string => {
    const { agentKey } = endpointLookupSchema.parse(input)
    return compiledEndpoints[agentKey]
  }
}
