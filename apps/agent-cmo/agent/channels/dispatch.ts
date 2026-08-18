import { createDispatchAckHandler } from '@repo/agents/dispatch-handler'
import { parseCmoAgentServerEnvironment } from '@repo/env/cmo-agent-server'
import { defineChannel, POST } from 'eve/channels'

import { ROOT_RUNTIME_CONTRACT } from '../lib/root-contract'

export const handleDispatchRequest = createDispatchAckHandler({
  readSecret: () => {
    try {
      return parseCmoAgentServerEnvironment(process.env).DISPATCH_SECRET
    } catch {
      // Invalid runtime configuration keeps dispatch closed.
    }
  },
})

export default defineChannel({
  routes: [
    POST(ROOT_RUNTIME_CONTRACT.dispatch.path, async (request) =>
      handleDispatchRequest(request)
    ),
  ],
})
