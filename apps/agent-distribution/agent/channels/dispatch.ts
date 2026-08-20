import { createDispatchAckHandler } from '@repo/agents/dispatch-handler'
import { readDispatchSecret } from '@repo/env/agent-server'
import { defineChannel, POST } from 'eve/channels'

import { ROOT_RUNTIME_CONTRACT } from '../lib/root-contract'

export const handleDispatchRequest = createDispatchAckHandler({
  readSecret: readDispatchSecret,
})

export default defineChannel({
  routes: [
    POST(ROOT_RUNTIME_CONTRACT.dispatch.path, async (request) =>
      handleDispatchRequest(request)
    ),
  ],
})
