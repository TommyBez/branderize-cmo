import { agentServerEnvironmentSchema, type EnvironmentSource } from './schema'

export type AgentServerEnvironment = ReturnType<
  typeof agentServerEnvironmentSchema.parse
>

export const parseAgentServerEnvironment = (
  source: EnvironmentSource
): AgentServerEnvironment => {
  if (source.DIRECT_DATABASE_URL !== undefined) {
    throw new Error(
      'DIRECT_DATABASE_URL must not be present in an agent deployment'
    )
  }

  return agentServerEnvironmentSchema.parse({
    DATABASE_URL: source.DATABASE_URL,
    DISPATCH_SECRET: source.DISPATCH_SECRET,
    NODE_ENV: source.NODE_ENV,
  })
}
