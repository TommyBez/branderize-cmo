import { createRootRuntimeContract } from '@repo/agents/root-runtime'

import { defineSpecialistDispatchChannel } from './dispatch-channel'

export const proveContentCannotMountSpecialistChannel = (): void => {
  // @ts-expect-error Content is health-only and cannot mount the specialist drain.
  defineSpecialistDispatchChannel(createRootRuntimeContract('content'))
}
