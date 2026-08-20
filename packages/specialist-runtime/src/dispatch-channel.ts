import {
  createPayloadFreeDispatchHandler,
  type DispatchSecretDependencies,
} from '@repo/agents/dispatch-handler'
import type { SpecialistRootContract } from '@repo/agents/root-runtime'
import { readDispatchSecret } from '@repo/env/agent-server'
import {
  type ChannelFrom,
  defineChannel,
  POST,
  type RouteHandlerArgs,
} from 'eve/channels'

import { createBrainTaskLifecycle } from './brain-lifecycle'
import { drainSpecialistTasks } from './drain'

type SpecialistDispatchRoute = Pick<RouteHandlerArgs, 'from' | 'waitUntil'>

export interface SpecialistDispatchHandlerDependencies
  extends DispatchSecretDependencies {
  readonly drain: (from: ChannelFrom) => Promise<unknown>
}

export const createSpecialistDispatchHandler = ({
  drain,
  readSecret,
}: SpecialistDispatchHandlerDependencies): ((
  request: Request,
  route: SpecialistDispatchRoute
) => Promise<Response>) =>
  createPayloadFreeDispatchHandler<SpecialistDispatchRoute>({
    onAccepted: (route) => {
      const backgroundDrain = Promise.resolve().then(() => drain(route.from))
      route.waitUntil(backgroundDrain)
    },
    readSecret,
  })

export const defineSpecialistDispatchChannel = (
  contract: SpecialistRootContract
) => {
  const handle = createSpecialistDispatchHandler({
    drain: async (from) => {
      await drainSpecialistTasks({
        from,
        kinds: contract.dispatch.claimableTaskKinds,
        lifecycle: createBrainTaskLifecycle(),
        now: () => new Date(),
        workerKey: contract.agentKey,
      })
    },
    readSecret: readDispatchSecret,
  })

  return defineChannel({
    routes: [
      POST(contract.dispatch.path, async (request, route) =>
        handle(request, route)
      ),
    ],
  })
}
