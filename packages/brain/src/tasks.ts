// biome-ignore-all lint/performance/noBarrelFile: Stable public compatibility facade; lifecycle ownership remains in the task-* modules.
export {
  claimContextAdapters,
  type RegisteredTaskClaimAdapter,
  type RegisteredTaskClaimAdapterInput,
} from './task-claim-adapters'
export {
  AGENT_DELIVERY_RECOVERY_WINDOW_MS,
  bindTaskSession,
  claimNextDueWorkerTask,
  claimRegisteredAgentTask,
  failRegisteredAgentDelivery,
} from './task-claim-lease'
export {
  type ClaimedTask,
  PRODUCT_MARKETER_TASK_KIND,
  PRODUCT_MARKETER_WORKER_KEY,
  type RegisteredTaskDeliveryClaim,
  type RegisteredTaskDeliveryFailure,
  type RequestSpecialistWorkInput,
  type RequestSpecialistWorkReceipt,
  type ResolveTaskQuestionsInput,
  requestSpecialistWorkInputSchema,
  resolveTaskQuestionsInputSchema,
  type StagedTaskCompletion,
  type TaskGeneration,
  type TaskQuestionsResolvedReceipt,
  taskGenerationOf,
} from './task-contracts'
export { finishTask } from './task-finish'
export { resolveTaskQuestions } from './task-question-resolution'
export { requestSpecialistWork } from './task-request'
