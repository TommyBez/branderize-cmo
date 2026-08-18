import type { AgentDefinition } from 'eve'

import { type CompiledRootManifest, getRootManifest } from './manifest'
import { createEveModelConfig, type EveModelConfigInput } from './model-config'
import {
  type AgentKey,
  agentRegistry,
  type DeploymentEnvironment,
} from './registry'

export interface RootRuntimeContract<TAgentKey extends AgentKey> {
  readonly agentKey: TAgentKey
  readonly dispatch: {
    readonly method: 'POST'
    readonly path: '/internal/dispatch'
    readonly supportedTaskKinds: CompiledRootManifest['supportedTaskKinds']
  }
  readonly functional: boolean
  readonly health: {
    readonly method: 'GET'
    readonly path: '/eve/v1/health'
    readonly public: true
  }
}

export const createRootRuntimeContract = <TAgentKey extends AgentKey>(
  agentKey: TAgentKey
) => {
  const rootDefinition = agentRegistry[agentKey]
  const rootManifest = getRootManifest(agentKey)
  const functional = rootDefinition.status === 'functional'

  if (rootManifest.functional !== functional) {
    throw new Error(
      `The ${agentKey} root manifest does not match the agent registry`
    )
  }
  if (!(functional || rootManifest.supportedTaskKinds.length === 0)) {
    throw new Error(
      `The ${agentKey} health-only root cannot advertise task kinds`
    )
  }

  return {
    agentKey,
    dispatch: {
      method: 'POST',
      path: '/internal/dispatch',
      supportedTaskKinds: rootManifest.supportedTaskKinds,
    },
    functional,
    health: {
      method: 'GET',
      path: '/eve/v1/health',
      public: true,
    },
  } satisfies RootRuntimeContract<TAgentKey>
}

export const resolveDeploymentEnvironment = (
  source: Readonly<Record<string, string | undefined>>
): DeploymentEnvironment => {
  if (source.NODE_ENV === 'test') {
    return 'test'
  }
  if (source.VERCEL_ENV === 'production') {
    return 'production'
  }
  if (source.VERCEL_ENV === 'preview') {
    return 'preview'
  }
  if (source.NODE_ENV === 'production') {
    return 'production'
  }
  return 'development'
}

export const createRootAgentDefinition = (input: EveModelConfigInput) =>
  ({
    model: createEveModelConfig(input),
    reasoning: 'high',
  }) satisfies AgentDefinition
