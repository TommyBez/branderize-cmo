import type { AgentKey } from '@repo/agents'
import {
  createRootRuntimeContract,
  resolveDeploymentEnvironment,
} from '@repo/agents/root-runtime'

export const ROOT_AGENT_KEY = 'seo-discovery' satisfies AgentKey

export const ROOT_RUNTIME_CONTRACT = createRootRuntimeContract(ROOT_AGENT_KEY)

export const DEPLOYMENT_ENVIRONMENT = resolveDeploymentEnvironment(process.env)
