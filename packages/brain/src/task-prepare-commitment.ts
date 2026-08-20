import { randomUUID } from 'node:crypto'

import { getTaskKind } from '@repo/agents'
import { notionPagePayloadSchema } from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import { objects, tasks } from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { operationKey, requestHash } from './canonical'
import type { TrustedMemberAccess } from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  requireCurrentBrandMember,
  requireMutationRole,
  requireTrustedHumanActor,
} from './internal'
import { acquireCommitmentDismissalLock } from './receipts'
import {
  type PrepareCommitmentInput,
  type PreparedCommitmentReceipt,
  prepareCommitmentInputSchema,
  preparedCommitmentReceiptSchema,
} from './task-commitment-contracts'
import { readLatestCommitmentDismissalFact } from './task-dismissal'

const requireActiveContentReport = async ({
  brandId,
  reportObjectId,
  transaction,
}: {
  readonly brandId: string
  readonly reportObjectId: string
  readonly transaction: BrainTransaction
}): Promise<void> => {
  const [report] = await transaction
    .select({ id: objects.id })
    .from(objects)
    .where(
      and(
        eq(objects.brandId, brandId),
        eq(objects.id, reportObjectId),
        eq(objects.status, 'active'),
        eq(objects.type, 'report')
      )
    )
    .for('share')
    .limit(1)
  if (report === undefined) {
    return fail(
      'invalid_task',
      'A commitment requires an active same-brand Content report'
    )
  }
}

export const dismissedCommitmentDispositionSchema = z
  .object({
    disposition: z.literal('dismissed'),
  })
  .strict()

export type DismissedCommitmentDisposition = z.infer<
  typeof dismissedCommitmentDispositionSchema
>
export type PrepareCommitmentResult =
  | DismissedCommitmentDisposition
  | PreparedCommitmentReceipt

export const isDismissedCommitmentDisposition = (
  result: PrepareCommitmentResult
): result is DismissedCommitmentDisposition =>
  'disposition' in result && result.disposition === 'dismissed'

const receiptOf = (task: {
  readonly id: string
  readonly kind: string
  readonly revision: number
  readonly subjectKey: string
}): PreparedCommitmentReceipt =>
  preparedCommitmentReceiptSchema.parse({
    kind: task.kind,
    outcome: 'commitment_prepared',
    revision: 1,
    subjectKey: task.subjectKey,
    taskId: task.id,
  })

export const prepareCommitment = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: PrepareCommitmentInput
}): Promise<PrepareCommitmentResult> => {
  const parsed = prepareCommitmentInputSchema.parse(input)
  const taskKind = getTaskKind(parsed.kind)
  if (
    taskKind.activation !== 'human' ||
    taskKind.executionMode !== 'direct' ||
    taskKind.commitment === undefined
  ) {
    return fail(
      'invalid_task',
      'Only a registered human commitment kind can be prepared'
    )
  }
  const payload = taskKind.briefSchema.parse(parsed.payload)
  const payloadHash = requestHash(payload)
  const receiptOperationKey = operationKey(
    'prepare-commitment:human',
    parsed.requestId
  )
  const semanticHash = requestHash({
    brandId: access.brandId,
    kind: parsed.kind,
    organizationId: access.organizationId,
    payload,
    userId: access.userId,
  })
  const taskIdempotencyKey = `task:${requestHash({
    brandId: access.brandId,
    receiptOperationKey,
  })}`

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    await requireTrustedHumanActor(transaction, access)
    requireMutationRole(currentMember.role)
    await acquireCommitmentDismissalLock({
      brandId: access.brandId,
      kind: parsed.kind,
      payloadHash,
      transaction,
    })

    const [existing] = await transaction
      .select({
        creationHash: tasks.creationHash,
        id: tasks.id,
        kind: tasks.kind,
        revision: tasks.revision,
        subjectKey: tasks.subjectKey,
      })
      .from(tasks)
      .where(eq(tasks.idempotencyKey, taskIdempotencyKey))
      .limit(1)
    if (existing !== undefined) {
      if (existing.creationHash !== semanticHash) {
        return fail(
          'operation_conflict',
          'The prepare operation key was already committed with different semantics'
        )
      }
      return receiptOf(existing)
    }

    const latestFact = await readLatestCommitmentDismissalFact({
      brandId: access.brandId,
      kind: parsed.kind,
      payloadHash,
      transaction,
    })
    if (latestFact?.fact === 'dismissal') {
      return dismissedCommitmentDispositionSchema.parse({
        disposition: 'dismissed',
      })
    }

    if (parsed.kind === 'content.notion-page.v1') {
      const notionPayload = notionPagePayloadSchema.parse(payload)
      await requireActiveContentReport({
        brandId: access.brandId,
        reportObjectId: notionPayload.reportObjectId,
        transaction,
      })
    }

    const taskId = randomUUID()
    const subjectKey = `commitment:${taskId}`
    const [inserted] = await transaction
      .insert(tasks)
      .values({
        activation: taskKind.activation,
        brandId: access.brandId,
        creationHash: semanticHash,
        executionMode: taskKind.executionMode,
        id: taskId,
        idempotencyKey: taskIdempotencyKey,
        kind: taskKind.kind,
        payload,
        payloadHash,
        revision: 1,
        status: 'awaiting_approval',
        subjectKey,
        workerKey: taskKind.workerKey,
      })
      .onConflictDoNothing()
      .returning({
        id: tasks.id,
        kind: tasks.kind,
        revision: tasks.revision,
        subjectKey: tasks.subjectKey,
      })
    if (inserted !== undefined) {
      return receiptOf(inserted)
    }

    const [concurrent] = await transaction
      .select({
        creationHash: tasks.creationHash,
        id: tasks.id,
        kind: tasks.kind,
        revision: tasks.revision,
        subjectKey: tasks.subjectKey,
      })
      .from(tasks)
      .where(eq(tasks.idempotencyKey, taskIdempotencyKey))
      .limit(1)
    if (concurrent === undefined) {
      return fail(
        'operation_conflict',
        'Commitment preparation conflicted without an observable canonical winner'
      )
    }
    if (concurrent.creationHash !== semanticHash) {
      return fail(
        'operation_conflict',
        'The prepare operation key was already committed with different semantics'
      )
    }
    return receiptOf(concurrent)
  })
}
