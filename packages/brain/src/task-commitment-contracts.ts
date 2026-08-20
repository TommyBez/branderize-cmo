import {
  getTaskKind,
  type RegisteredTaskKindKey,
  registeredTaskKindKeySchema,
} from '@repo/agents'
import { notionPagePayloadSchema } from '@repo/agents/tasks'
import { z } from 'zod'

const nonBlankSchema = z.string().trim().min(1)

export const SERIALIZED_COMMITMENT_FIXTURE_KIND =
  'fixture.serialized-target.v1' as const

export const serializedCommitmentFixturePayloadSchema = z
  .object({
    targetKey: nonBlankSchema.max(200),
  })
  .strict()

export const prepareCommitmentInputSchema = z
  .object({
    kind: registeredTaskKindKeySchema,
    payload: z.unknown(),
    requestId: nonBlankSchema.max(500),
  })
  .strict()
  .superRefine((input, context) => {
    const taskKind = getTaskKind(input.kind)
    if (taskKind.activation !== 'human' || taskKind.commitment === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Only a registered human commitment kind can be prepared',
        path: ['kind'],
      })
      return
    }
    const payload = taskKind.briefSchema.safeParse(input.payload)
    if (!payload.success) {
      context.addIssue({
        code: 'custom',
        message: 'Payload does not match the registered commitment kind',
        path: ['payload'],
      })
    }
  })

export const preparedCommitmentReceiptSchema = z
  .object({
    kind: registeredTaskKindKeySchema,
    outcome: z.literal('commitment_prepared'),
    revision: z.literal(1),
    subjectKey: nonBlankSchema,
    taskId: z.uuid(),
  })
  .strict()

export const approveTaskInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    requestId: nonBlankSchema.max(500),
    taskId: z.uuid(),
  })
  .strict()

const approvedTaskReceiptSchema = z
  .object({
    actionId: z.uuid(),
    approvedAt: z.iso.datetime(),
    conflictKey: z.string().trim().min(1).max(500).nullable(),
    effect: z
      .object({
        class: z.enum([
          'communication',
          'irreversible-external',
          'reversible-external',
        ]),
        phase: z.literal('external-commitment'),
      })
      .strict(),
    kind: z.string().trim().min(1),
    outcome: z.literal('approved'),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
    revision: z.number().int().positive(),
    taskId: z.uuid(),
  })
  .strict()

const targetBusyReceiptSchema = z
  .object({
    blockingTaskId: z.uuid(),
    outcome: z.literal('target_busy'),
    taskId: z.uuid(),
  })
  .strict()

export const approveTaskReceiptSchema = z.discriminatedUnion('outcome', [
  approvedTaskReceiptSchema,
  targetBusyReceiptSchema,
])

export const commitmentApprovalActionPayloadSchema = z
  .object({
    conflictKey: z.string().trim().min(1).max(500).nullable(),
    effect: z
      .object({
        class: z.enum([
          'communication',
          'irreversible-external',
          'reversible-external',
        ]),
        phase: z.literal('external-commitment'),
      })
      .strict(),
    kind: z.string().trim().min(1),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
    revision: z.number().int().positive(),
    taskId: z.uuid(),
  })
  .strict()

export const commitmentOutcomeSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('accepted'),
      receipt: z.unknown(),
    })
    .strict(),
  z
    .object({
      code: nonBlankSchema.max(120),
      message: nonBlankSchema.max(2000),
      outcome: z.literal('rejected'),
    })
    .strict(),
  z
    .object({
      code: nonBlankSchema.max(120),
      message: nonBlankSchema.max(2000),
      outcome: z.literal('unknown'),
    })
    .strict(),
])

export const commitmentResultActionPayloadSchema = z.discriminatedUnion(
  'outcome',
  [
    z
      .object({
        authorizedByActionId: z.uuid(),
        outcome: z.literal('accepted'),
        receipt: z.unknown(),
        taskId: z.uuid(),
      })
      .strict(),
    z
      .object({
        authorizedByActionId: z.uuid(),
        code: nonBlankSchema.max(120),
        message: nonBlankSchema.max(2000),
        outcome: z.literal('rejected'),
        taskId: z.uuid(),
      })
      .strict(),
    z
      .object({
        authorizedByActionId: z.uuid(),
        code: nonBlankSchema.max(120),
        message: nonBlankSchema.max(2000),
        outcome: z.literal('unknown'),
        taskId: z.uuid(),
      })
      .strict(),
  ]
)

export type PrepareCommitmentInput = z.input<
  typeof prepareCommitmentInputSchema
>
export type PreparedCommitmentReceipt = z.infer<
  typeof preparedCommitmentReceiptSchema
>
export type ApproveTaskInput = z.input<typeof approveTaskInputSchema>
export type ApproveTaskReceipt = z.infer<typeof approveTaskReceiptSchema>
export type CommitmentOutcome = z.infer<typeof commitmentOutcomeSchema>
export type CommitmentResultActionPayload = z.infer<
  typeof commitmentResultActionPayloadSchema
>

export const isHumanCommitmentKind = (kind: RegisteredTaskKindKey): boolean => {
  const taskKind = getTaskKind(kind)
  return (
    taskKind.activation === 'human' &&
    taskKind.executionMode === 'direct' &&
    taskKind.commitment !== undefined
  )
}

export const notionPagePreparePayloadSchema = notionPagePayloadSchema
