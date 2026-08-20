// biome-ignore-all lint/performance/noBarrelFile: Testing surface re-exports drain and session helpers without a Database factory.

export {
  agentClaimableKindsOf,
  type DirectHumanDrainReport,
  type DirectHumanHandler,
  type DirectHumanLifecyclePort,
  drainDirectHumanCommitments,
  humanCommitmentKindsOf,
} from './direct-drain'
export {
  createSpecialistDispatchHandler,
  type SpecialistDispatchHandlerDependencies,
} from './dispatch-channel'
export {
  drainSpecialistTasks,
  type TaskDrainReport,
  type TaskLifecyclePort,
} from './drain'
export { createTaskSessionAuth, taskAddressOf } from './session-envelope'
export {
  readTaskSession,
  requireRootTaskSession,
  stableTaskRequestId,
  taskExecutionOf,
  taskSessionLineageFromContext,
} from './task-session'
