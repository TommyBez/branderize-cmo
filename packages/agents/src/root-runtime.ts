import type { AgentDefinition } from 'eve'

import { getRootManifest } from './manifest'
import { createEveModelConfig, type EveModelConfigInput } from './model-config'
import {
  type AgentKey,
  agentRegistry,
  type DeploymentEnvironment,
  type RegisteredTaskKindKey,
} from './registry'

export type RootRole = 'conversational' | 'health-only' | 'specialist'

type AgentTaskKinds<TAgentKey extends AgentKey> =
  (typeof agentRegistry)[TAgentKey]['taskKinds']

export type RootRoleOf<TAgentKey extends AgentKey> =
  AgentTaskKinds<TAgentKey> extends readonly []
    ? (typeof agentRegistry)[TAgentKey]['status'] extends 'functional'
      ? 'conversational'
      : 'health-only'
    : 'specialist'

export interface RootRuntimeContract<
  TAgentKey extends AgentKey = AgentKey,
  TRole extends RootRole = RootRoleOf<TAgentKey>,
> {
  readonly agentKey: TAgentKey
  readonly dispatch: {
    readonly claimableTaskKinds: TRole extends 'specialist'
      ? readonly [RegisteredTaskKindKey, ...RegisteredTaskKindKey[]]
      : readonly []
    readonly method: 'POST'
    readonly path: '/internal/dispatch'
  }
  readonly functional: boolean
  readonly health: {
    readonly method: 'GET'
    readonly path: '/eve/v1/health'
    readonly public: true
  }
  readonly role: TRole
}

export type SpecialistRootContract = {
  readonly [TAgentKey in AgentKey]: RootRoleOf<TAgentKey> extends 'specialist'
    ? RootRuntimeContract<TAgentKey, 'specialist'>
    : never
}[AgentKey]

const deriveRootRole = (
  functional: boolean,
  claimableTaskKinds: readonly RegisteredTaskKindKey[]
): RootRole => {
  if (claimableTaskKinds.length > 0) {
    return 'specialist'
  }
  return functional ? 'conversational' : 'health-only'
}

export const createRootRuntimeContract = <TAgentKey extends AgentKey>(
  agentKey: TAgentKey
): RootRuntimeContract<TAgentKey> => {
  const rootDefinition = agentRegistry[agentKey]
  const rootManifest = getRootManifest(agentKey)
  const functional = rootDefinition.status === 'functional'
  const claimableTaskKinds = rootManifest.supportedTaskKinds

  if (rootManifest.functional !== functional) {
    throw new Error(
      `The ${agentKey} root manifest does not match the agent registry`
    )
  }
  if (!(functional || claimableTaskKinds.length === 0)) {
    throw new Error(
      `The ${agentKey} health-only root cannot advertise task kinds`
    )
  }

  return {
    agentKey,
    dispatch: {
      claimableTaskKinds:
        claimableTaskKinds as RootRuntimeContract<TAgentKey>['dispatch']['claimableTaskKinds'],
      method: 'POST',
      path: '/internal/dispatch',
    },
    functional,
    health: {
      method: 'GET',
      path: '/eve/v1/health',
      public: true,
    },
    role: deriveRootRole(
      functional,
      claimableTaskKinds
    ) as RootRoleOf<TAgentKey>,
  }
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
