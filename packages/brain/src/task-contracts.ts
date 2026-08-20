import {
  type AgentKey,
  type ClaimContextOf,
  getTaskKind,
  type RegisteredTaskCompletionValue,
  type RegisteredTaskKindKey,
  registeredTaskKindKeySchema,
  type TaskPayloadOf,
} from '@repo/agents'
import type { TaskIntentSnapshot } from '@repo/agents/task-snapshot'
import {
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

declare const taskGenerationBrand: unique symbol

export type TaskGeneration = Date & {
  readonly [taskGenerationBrand]: true
}

export const taskGenerationOf = (value: Date): TaskGeneration =>
  value as TaskGeneration

export interface ClaimedTask<
  TKind extends RegisteredTaskKindKey = RegisteredTaskKindKey,
> {
  readonly agentActorId: string
  readonly agentActorKey: `agent:${AgentKey}`
  readonly brandId: string
  readonly claimContext: ClaimContextOf<TKind>
  readonly intentSnapshot: TaskIntentSnapshot
  readonly kind: TKind
  readonly payload: TaskPayloadOf<TKind>
  readonly startedAt: TaskGeneration
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
