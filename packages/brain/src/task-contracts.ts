import {
  type AgentKey,
  getTaskKind,
  type RegisteredTaskCompletionValue,
  type RegisteredTaskKindKey,
  registeredTaskKindKeySchema,
} from '@repo/agents'
import {
  type ProductMarketerPayload,
  PRODUCT_MARKETER_TASK_KIND as registeredProductMarketerTaskKind,
  PRODUCT_MARKETER_WORKER_KEY as registeredProductMarketerWorkerKey,
} from '@repo/agents/tasks'
import { z } from 'zod'

import { memberRoleSchema } from './context'

export const PRODUCT_MARKETER_TASK_KIND = registeredProductMarketerTaskKind
export const PRODUCT_MARKETER_WORKER_KEY = registeredProductMarketerWorkerKey

const nonBlankSchema = z.string().trim().min(1)
export const taskReceiptSha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const requestSpecialistWorkInputSchema = z
  .object({
    intentId: z.uuid(),
    kind: registeredTaskKindKeySchema,
    payload: z.unknown(),
    requestId: nonBlankSchema.max(500),
  })
  .strict()
  .superRefine((input, context) => {
    const payload = getTaskKind(input.kind).briefSchema.safeParse(input.payload)
    if (!payload.success) {
      context.addIssue({
        code: 'custom',
        message: 'Payload does not match the registered task kind',
        path: ['payload'],
      })
    }
  })

export const createdSpecialistWorkReceiptSchema = z
  .object({
    actionId: z.uuid(),
    disposition: z.literal('created'),
    intentId: z.uuid(),
    intentRevision: z.number().int().positive(),
    outcome: z.literal('specialist_work_requested'),
    taskId: z.uuid(),
  })
  .strict()

const observedSpecialistWorkReceiptSchema = z
  .object({
    disposition: z.literal('already_active'),
    intentId: z.uuid(),
    intentRevision: z.number().int().positive(),
    outcome: z.literal('specialist_work_observed'),
    taskId: z.uuid(),
  })
  .strict()

export const requestSpecialistWorkReceiptSchema = z.discriminatedUnion(
  'disposition',
  [createdSpecialistWorkReceiptSchema, observedSpecialistWorkReceiptSchema]
)

const taskQuestionAuthorizingHumanSchema = z
  .object({
    actorId: nonBlankSchema,
    actorKey: nonBlankSchema,
    organizationId: nonBlankSchema,
    role: memberRoleSchema,
    userId: nonBlankSchema,
  })
  .strict()

const taskQuestionProducerContextSchema = z
  .object({
    actorId: nonBlankSchema,
    actorKey: z.literal('agent:cmo'),
    callId: nonBlankSchema,
    conversationId: z.uuid(),
    sessionId: nonBlankSchema,
    turnId: nonBlankSchema,
  })
  .strict()

const taskQuestionResolutionInputShape = {
  rationale: nonBlankSchema.max(3000),
  requestId: nonBlankSchema.max(500),
  taskId: z.uuid(),
}

export const resolveTaskQuestionsInputSchema = z.discriminatedUnion(
  'disposition',
  [
    z
      .object({
        ...taskQuestionResolutionInputShape,
        disposition: z.literal('answered'),
      })
      .strict(),
    z
      .object({
        ...taskQuestionResolutionInputShape,
        disposition: z.literal('no_longer_relevant'),
      })
      .strict(),
  ]
)

const taskQuestionsResolvedReceiptShape = {
  actionId: z.uuid(),
  authorizingHuman: taskQuestionAuthorizingHumanSchema,
  completionHash: taskReceiptSha256Schema,
  outcome: z.literal('task_questions_resolved'),
  producerContext: taskQuestionProducerContextSchema,
  rationale: nonBlankSchema.max(3000),
  taskId: z.uuid(),
}

export const taskQuestionsResolvedReceiptSchema = z.discriminatedUnion(
  'disposition',
  [
    z
      .object({
        ...taskQuestionsResolvedReceiptShape,
        disposition: z.literal('answered'),
      })
      .strict(),
    z
      .object({
        ...taskQuestionsResolvedReceiptShape,
        disposition: z.literal('no_longer_relevant'),
      })
      .strict(),
  ]
)

export const taskIntentSnapshotSchema = z
  .object({
    acceptance_criteria: z.array(z.json()).min(1).nullable(),
    brand_id: z.uuid(),
    constraints: z.array(z.json()).min(1).nullable(),
    intent_id: z.uuid(),
    intent_revision: z.number().int().positive(),
    preauthorizations: z.array(
      z
        .object({
          authorizedIntentRevision: z.number().int().positive(),
          decisionId: nonBlankSchema,
        })
        .strict()
    ),
    statement: nonBlankSchema,
  })
  .strict()

export type RequestSpecialistWorkInput = z.input<
  typeof requestSpecialistWorkInputSchema
>
export type RequestSpecialistWorkReceipt = z.infer<
  typeof requestSpecialistWorkReceiptSchema
>
export type ResolveTaskQuestionsInput = z.input<
  typeof resolveTaskQuestionsInputSchema
>
export type ParsedResolveTaskQuestionsInput = z.output<
  typeof resolveTaskQuestionsInputSchema
>
export type TaskQuestionsResolvedReceipt = z.infer<
  typeof taskQuestionsResolvedReceiptSchema
>
export type TaskIntentSnapshot = z.infer<typeof taskIntentSnapshotSchema>

export interface ClaimedRegisteredAgentTask<
  TKind extends RegisteredTaskKindKey = RegisteredTaskKindKey,
  TAdapterContext = unknown,
> {
  readonly adapterContext: TAdapterContext
  readonly agentActorId: string
  readonly agentActorKey: `agent:${AgentKey}`
  readonly brandId: string
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: TKind
  readonly payload: unknown
  readonly startedAt: Date
  readonly taskId: string
  readonly workerKey: AgentKey
}

export interface RegisteredTaskDeliveryClaim {
  readonly agentActorId: string
  readonly agentActorKey: `agent:${AgentKey}`
  readonly brandId: string
  readonly kind: RegisteredTaskKindKey
  readonly startedAt: Date
  readonly taskId: string
  readonly workerKey: AgentKey
}

export interface RegisteredTaskDeliveryFailure {
  readonly outcome: 'delivery_failed' | 'not_unbound_running'
  readonly taskId: string
}

export interface ClaimedProductMarketerTask {
  readonly agentActorId: string
  readonly agentActorKey: `agent:${typeof PRODUCT_MARKETER_WORKER_KEY}`
  readonly brandContextContent: unknown
  readonly brandContextObjectId: string
  readonly brandId: string
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: typeof PRODUCT_MARKETER_TASK_KIND
  readonly payload: ProductMarketerPayload
  readonly startedAt: Date
  readonly taskId: string
  readonly workerKey: typeof PRODUCT_MARKETER_WORKER_KEY
}

export type ProductMarketerDeliveryFailure = RegisteredTaskDeliveryFailure

export interface StagedTaskCompletion {
  readonly completion: RegisteredTaskCompletionValue
  readonly outcome: 'completion_staged'
  readonly taskId: string
}

export const taskExecutionGenerationMatches = (
  persistedStartedAt: Date | null,
  expectedStartedAt: Date
): boolean =>
  persistedStartedAt !== null &&
  persistedStartedAt.getTime() === expectedStartedAt.getTime()
