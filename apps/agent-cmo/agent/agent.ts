import { createRootAgentDefinition } from '@repo/agents/root-runtime'
import { defineAgent } from 'eve'

import { DEPLOYMENT_ENVIRONMENT, ROOT_AGENT_KEY } from './lib/root-contract'

export default defineAgent(
  createRootAgentDefinition({
    agentKey: ROOT_AGENT_KEY,
    environment: DEPLOYMENT_ENVIRONMENT,
    lane: 'cmo',
  })
)
