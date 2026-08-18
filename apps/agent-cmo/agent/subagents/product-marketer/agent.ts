import { agentRegistry } from '@repo/agents'
import { createEveModelConfig } from '@repo/agents/model-config'
import { defineAgent } from 'eve'

import { DEPLOYMENT_ENVIRONMENT } from '../../lib/root-contract'

const productMarketer = agentRegistry['product-marketer']

export const productMarketerConsultationModel = createEveModelConfig({
  agentKey: productMarketer.key,
  environment: DEPLOYMENT_ENVIRONMENT,
  lane: 'consultation',
})

export default defineAgent({
  description:
    'Provide read-only Product Marketing analysis from context explicitly supplied by the CMO. Never authorize work or claim a canonical write.',
  model: productMarketerConsultationModel,
  reasoning: 'high',
})
