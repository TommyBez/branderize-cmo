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

import { createBrainHumanLifecycle } from './brain-human-lifecycle'
import { createBrainTaskLifecycle } from './brain-lifecycle'
import {
  agentClaimableKindsOf,
  type DirectHumanHandler,
  drainDirectHumanCommitments,
  humanCommitmentKindsOf,
} from './direct-drain'
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
  contract: SpecialistRootContract,
  human?: {
    readonly handler: DirectHumanHandler
  }
) => {
  const handle = createSpecialistDispatchHandler({
    drain: async (from) => {
      const humanKinds = humanCommitmentKindsOf(
        contract.dispatch.claimableTaskKinds
      )
      const [firstHumanKind, ...restHumanKinds] = humanKinds
      if (human !== undefined && firstHumanKind !== undefined) {
        await drainDirectHumanCommitments({
          handler: human.handler,
          kinds: [firstHumanKind, ...restHumanKinds],
          lifecycle: createBrainHumanLifecycle(),
          now: () => new Date(),
          workerKey: contract.agentKey,
        })
      }
      const agentKinds = agentClaimableKindsOf(
        contract.dispatch.claimableTaskKinds
      )
      const [firstAgentKind, ...restAgentKinds] = agentKinds
      if (firstAgentKind === undefined) {
        return
      }
      await drainSpecialistTasks({
        from,
        kinds: [firstAgentKind, ...restAgentKinds],
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
