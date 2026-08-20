import {
  cmoAgentServerEnvironmentSchema,
  type EnvironmentSource,
} from './schema'

export type CmoAgentServerEnvironment = ReturnType<
  typeof cmoAgentServerEnvironmentSchema.parse
>

export const parseCmoAgentServerEnvironment = (
  source: EnvironmentSource
): CmoAgentServerEnvironment => {
  if (source.DIRECT_DATABASE_URL !== undefined) {
    throw new Error(
      'DIRECT_DATABASE_URL must not be present in the CMO agent deployment'
    )
  }

  return cmoAgentServerEnvironmentSchema.parse({
    AGENT_CONTENT_URL: source.AGENT_CONTENT_URL,
    AGENT_DISTRIBUTION_URL: source.AGENT_DISTRIBUTION_URL,
    AGENT_PRODUCT_MARKETER_URL: source.AGENT_PRODUCT_MARKETER_URL,
    AGENT_SEO_DISCOVERY_URL: source.AGENT_SEO_DISCOVERY_URL,
    CMO_BRIDGE_SECRET: source.CMO_BRIDGE_SECRET,
    DATABASE_URL: source.DATABASE_URL,
    DISPATCH_SECRET: source.DISPATCH_SECRET,
    NODE_ENV: source.NODE_ENV,
  })
}
