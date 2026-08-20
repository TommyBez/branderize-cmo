import { createRootRuntimeContract } from '@repo/agents/root-runtime'

import { defineSpecialistDispatchChannel } from './dispatch-channel'

export const proveContentCanMountSpecialistChannel = (): void => {
  defineSpecialistDispatchChannel(createRootRuntimeContract('content'))
}

export const proveLifecycleCannotMountSpecialistChannel = (): void => {
  // @ts-expect-error Lifecycle is health-only and cannot mount the specialist drain.
  defineSpecialistDispatchChannel(createRootRuntimeContract('lifecycle'))
}
