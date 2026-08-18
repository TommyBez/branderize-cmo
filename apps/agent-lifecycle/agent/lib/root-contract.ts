import type { AgentKey, DeploymentEnvironment } from '@repo/agents'
import { agentRegistry } from '@repo/agents'
import { getRootManifest } from '@repo/agents/manifest'

export const ROOT_AGENT_KEY = 'lifecycle' satisfies AgentKey

const rootDefinition = agentRegistry[ROOT_AGENT_KEY]
const rootManifest = getRootManifest(ROOT_AGENT_KEY)

if (
  rootManifest.functional ||
  rootDefinition.status !== 'health-only' ||
  rootManifest.supportedTaskKinds.length > 0
) {
  throw new Error('The Lifecycle root must remain health-only in Phase 0')
}

export const ROOT_RUNTIME_CONTRACT = {
  agentKey: ROOT_AGENT_KEY,
  dispatch: {
    method: 'POST',
    path: '/internal/dispatch',
    supportedTaskKinds: rootManifest.supportedTaskKinds,
  },
  functional: rootManifest.functional,
  health: {
    method: 'GET',
    path: '/eve/v1/health',
    public: true,
  },
} as const

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

export const DEPLOYMENT_ENVIRONMENT = resolveDeploymentEnvironment(process.env)
