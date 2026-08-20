// biome-ignore-all lint/performance/noBarrelFile: Stable public compatibility facade; lifecycle ownership remains in the task-* modules.

export { requestLateralWork } from './lateral-request'
export { approveTask } from './task-approval'
export {
  type CancelTaskInput,
  type CancelTaskReceipt,
  cancelTask,
  cancelTaskInputSchema,
  cancelTaskReceiptSchema,
} from './task-cancellation'
export {
  claimContextAdapters,
  type RegisteredTaskClaimAdapter,
  type RegisteredTaskClaimAdapterInput,
} from './task-claim-adapters'
export {
  type ClaimedHumanCommitment,
  claimNextDueHumanCommitment,
  claimRegisteredHumanCommitment,
  HUMAN_COMMITMENT_STALE_AFTER_MS,
  type HumanCommitmentClaimResult,
} from './task-claim-human'
export {
  AGENT_DELIVERY_RECOVERY_WINDOW_MS,
  bindTaskSession,
  claimNextDueWorkerTask,
  claimRegisteredAgentTask,
  failRegisteredAgentDelivery,
} from './task-claim-lease'
export {
  type ApproveTaskInput,
  type ApproveTaskReceipt,
  approveTaskInputSchema,
  approveTaskReceiptSchema,
  type CommitmentOutcome,
  type PrepareCommitmentInput,
  type PreparedCommitmentReceipt,
  prepareCommitmentInputSchema,
  SERIALIZED_COMMITMENT_FIXTURE_KIND,
} from './task-commitment-contracts'
export {
  type ClaimedTask,
  PRODUCT_MARKETER_TASK_KIND,
  PRODUCT_MARKETER_WORKER_KEY,
  type RegisteredTaskDeliveryClaim,
  type RegisteredTaskDeliveryFailure,
  type RequestLateralWorkInput,
  type RequestLateralWorkReceipt,
  type RequestSpecialistWorkInput,
  type RequestSpecialistWorkReceipt,
  type ResolveTaskQuestionsInput,
  requestLateralWorkInputSchema,
  requestSpecialistWorkInputSchema,
  resolveTaskQuestionsInputSchema,
  type StagedTaskCompletion,
  type TaskGeneration,
  type TaskQuestionsResolvedReceipt,
  taskGenerationOf,
} from './task-contracts'
export {
  type DismissTaskInput,
  type DismissTaskReceipt,
  dismissTask,
  dismissTaskInputSchema,
  dismissTaskReceiptSchema,
  type ReopenTaskInput,
  type ReopenTaskReceipt,
  reopenTask,
  reopenTaskInputSchema,
  reopenTaskReceiptSchema,
} from './task-dismissal'
export { finishTask } from './task-finish'
export {
  type DismissedCommitmentDisposition,
  dismissedCommitmentDispositionSchema,
  isDismissedCommitmentDisposition,
  type PrepareCommitmentResult,
  prepareCommitment,
} from './task-prepare-commitment'
export { resolveTaskQuestions } from './task-question-resolution'
export { requestSpecialistWork } from './task-request'
export {
  classifyUnexpectedThrow,
  type HumanCommitmentSettlement,
  STALE_HUMAN_COMMITMENT_CODE,
  settleHumanCommitmentResult,
  settleStaleHumanCommitments,
} from './task-result'
