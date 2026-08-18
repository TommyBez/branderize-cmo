import {
  AGENT_KEYS,
  type AgentKey,
  agentRegistry,
  type RegisteredTaskKindKey,
} from './registry'

export interface CompiledRootManifest {
  readonly agentKey: AgentKey
  readonly functional: boolean
  readonly supportedTaskKinds: readonly RegisteredTaskKindKey[]
}

export const rootManifest: readonly CompiledRootManifest[] = AGENT_KEYS.map(
  (agentKey) => {
    const agent = agentRegistry[agentKey]
    return {
      agentKey,
      functional: agent.status === 'functional',
      supportedTaskKinds: agent.taskKinds.map(({ kind }) => kind),
    }
  }
)

export const getRootManifest = (agentKey: AgentKey): CompiledRootManifest => {
  const root = rootManifest.find((entry) => entry.agentKey === agentKey)
  if (root === undefined) {
    throw new Error(`Missing compiled root manifest for ${agentKey}`)
  }
  return root
}
