export type BrainErrorCode =
  | 'access_denied'
  | 'already_claimed'
  | 'brand_not_found'
  | 'completion_conflict'
  | 'conversation_not_found'
  | 'credits_exhausted'
  | 'invalid_completion'
  | 'invalid_event'
  | 'invalid_operation'
  | 'invalid_output'
  | 'invalid_task'
  | 'intent_not_active'
  | 'intent_not_draft'
  | 'intent_not_found'
  | 'operation_conflict'
  | 'stale_head'
  | 'stale_intent'
  | 'stale_revision'
  | 'task_closed'
  | 'task_not_found'
  | 'task_not_running'
  | 'unsupported_task_kind'

export class BrainError extends Error {
  readonly code: BrainErrorCode

  constructor(code: BrainErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'BrainError'
  }
}

export const fail = (code: BrainErrorCode, message: string): never => {
  throw new BrainError(code, message)
}
