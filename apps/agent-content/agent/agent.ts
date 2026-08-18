import { agentRegistry } from '@repo/agents'
import { createEveModelConfig } from '@repo/agents/model-config'
import { defineAgent } from 'eve'

import { DEPLOYMENT_ENVIRONMENT, ROOT_AGENT_KEY } from './lib/root-contract'

const rootDefinition = agentRegistry[ROOT_AGENT_KEY]

export default defineAgent({
  model: createEveModelConfig({
    agentKey: rootDefinition.key,
    environment: DEPLOYMENT_ENVIRONMENT,
    lane: 'task',
  }),
  reasoning: 'high',
})
