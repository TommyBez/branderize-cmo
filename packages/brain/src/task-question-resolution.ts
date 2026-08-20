import { randomUUID } from 'node:crypto'

import { getTaskKind, registeredTaskKindKeySchema } from '@repo/agents'
import { taskIntentSnapshotSchema } from '@repo/agents/task-snapshot'
import type { Database } from '@repo/db/client'
import { actions, tasks } from '@repo/db/schema/domain'
import { evaluatePolicy } from '@repo/policy'
import { and, eq } from 'drizzle-orm'

import { operationKey, requestHash } from './canonical'
import type { MemberRole, TrustedCmoTurnAccess } from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  requireCurrentBrandMember,
  requireMutationRole,
  requireTrustedCmoTurn,
  requireTrustedHumanActor,
} from './internal'
import { readActionReceipt } from './receipts'
import {
  type ParsedResolveTaskQuestionsInput,
  type ResolveTaskQuestionsInput,
  resolveTaskQuestionsInputSchema,
  type TaskQuestionsResolvedReceipt,
  taskQuestionsResolvedReceiptSchema,
  taskReceiptSha256Schema,
} from './task-contracts'

const taskQuestionsResolutionOperationKey = (taskId: string): string =>
  operationKey('resolve-task-questions', taskId)

const taskQuestionsResolutionFingerprint = ({
  access,
  completionHash,
  currentMemberRole,
  input,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly completionHash: string
  readonly currentMemberRole: MemberRole
  readonly input: ParsedResolveTaskQuestionsInput
}): {
  readonly operationKey: string
  readonly requestHash: string
} => {
  const receiptOperationKey = taskQuestionsResolutionOperationKey(input.taskId)
  const parsedCompletionHash = taskReceiptSha256Schema.parse(completionHash)
  const semanticHash = requestHash({
    authorizingHuman: {
      actorId: access.humanActorId,
      actorKey: access.humanActorKey,
      organizationId: access.organizationId,
      role: currentMemberRole,
      userId: access.userId,
    },
    brandId: access.brandId,
    completionHash: parsedCompletionHash,
    disposition: input.disposition,
    producer: {
      actorId: access.cmoActorId,
      actorKey: access.cmoActorKey,
      conversationId: access.conversationId,
      sessionId: access.sessionId,
      turnId: access.turnId,
    },
    rationale: input.rationale,
    taskId: input.taskId,
  })
  return { operationKey: receiptOperationKey, requestHash: semanticHash }
}

const loadTaskQuestionsResolutionFingerprint = async ({
  access,
  currentMemberRole,
  input,
  transaction,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly currentMemberRole: MemberRole
  readonly input: ParsedResolveTaskQuestionsInput
  readonly transaction: BrainTransaction
}): Promise<{
  readonly completionHash: string
  readonly operationKey: string
  readonly requestHash: string
}> => {
  const receiptOperationKey = taskQuestionsResolutionOperationKey(input.taskId)
  const [existingAction] = await transaction
    .select({ payload: actions.payload })
    .from(actions)
    .where(
      and(
        eq(actions.brandId, access.brandId),
        eq(actions.operationKey, receiptOperationKey)
      )
    )
    .limit(1)
  const existingReceipt =
    existingAction === undefined
      ? null
      : taskQuestionsResolvedReceiptSchema.parse(existingAction.payload)
  let completionHash = existingReceipt?.completionHash
  if (completionHash === undefined) {
    const [sourceTask] = await transaction
      .select({ completion: tasks.completion })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.brandId, access.brandId)))
      .limit(1)
    if (sourceTask === undefined) {
      return fail('task_not_found', 'Question bundle task does not exist')
    }
    completionHash = requestHash(sourceTask.completion)
  }
  return {
    completionHash,
    ...taskQuestionsResolutionFingerprint({
      access,
      completionHash,
      currentMemberRole:
        existingReceipt?.authorizingHuman.role ?? currentMemberRole,
      input,
    }),
  }
}

export const resolveTaskQuestions = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
  readonly input: ResolveTaskQuestionsInput
}): Promise<TaskQuestionsResolvedReceipt> => {
  const parsed = resolveTaskQuestionsInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    await requireTrustedHumanActor(transaction, access)
    await requireTrustedCmoTurn(transaction, access)

    const fingerprint = await loadTaskQuestionsResolutionFingerprint({
      access,
      currentMemberRole: currentMember.role,
      input: parsed,
      transaction,
    })
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: fingerprint.operationKey,
      receiptSchema: taskQuestionsResolvedReceiptSchema,
      requestHash: fingerprint.requestHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }
    requireMutationRole(currentMember.role)

    const [task] = await transaction
      .select({
        completion: tasks.completion,
        intentId: tasks.intentId,
        intentSnapshot: tasks.intentSnapshot,
        kind: tasks.kind,
        status: tasks.status,
        workerKey: tasks.workerKey,
      })
      .from(tasks)
      .where(
        and(eq(tasks.id, parsed.taskId), eq(tasks.brandId, access.brandId))
      )
      .for('share')
      .limit(1)
    if (task === undefined) {
      return fail('task_not_found', 'Question bundle task does not exist')
    }
    const registeredKind = registeredTaskKindKeySchema.safeParse(task.kind)
    if (!registeredKind.success) {
      return fail('invalid_task', 'Question bundle task kind is not registered')
    }
    const taskKind = getTaskKind(registeredKind.data)
    const completion = taskKind.completionSchema.safeParse(task.completion)
    const { questionPolicy } = taskKind
    if (
      task.status !== 'succeeded' ||
      task.workerKey !== taskKind.workerKey ||
      questionPolicy === null ||
      !completion.success ||
      !questionPolicy.hasOpenQuestions(completion.data)
    ) {
      return fail('invalid_task', 'Task has no settled open-question bundle')
    }
    if (requestHash(completion.data) !== fingerprint.completionHash) {
      return fail(
        'operation_conflict',
        'Task completion changed while resolving its question bundle'
      )
    }
    const intentSnapshot = taskIntentSnapshotSchema.safeParse(
      task.intentSnapshot
    )
    if (!intentSnapshot.success) {
      return fail('invalid_task', 'Task has an invalid Intent snapshot')
    }
    const policy = evaluatePolicy({
      actor: { actorKey: access.cmoActorKey, kind: 'agent' },
      authorization: {
        humanActorKey: access.humanActorKey,
        kind: 'member',
        membership: { kind: 'current', role: currentMember.role },
        mode: 'cmo-transduction',
      },
      capability: {
        capabilityKey: `task:${taskKind.kind}:resolve-questions`,
        kind: 'granted',
      },
      currentBrandRestrictions: [],
      effect: { phase: taskKind.effectPhase },
      origin: {
        kind: 'accepted-intent-work',
        snapshot: {
          acceptanceCriteria: intentSnapshot.data.acceptance_criteria,
          brandId: intentSnapshot.data.brand_id,
          constraints: intentSnapshot.data.constraints,
          intentId: intentSnapshot.data.intent_id,
          intentRevision: intentSnapshot.data.intent_revision,
          preauthorizations: intentSnapshot.data.preauthorizations,
        },
      },
    })
    if (policy.verdict !== 'allowed') {
      return fail(
        'access_denied',
        `Policy denied question resolution: ${policy.reason}`
      )
    }

    const actionId = randomUUID()
    const receipt: TaskQuestionsResolvedReceipt = {
      actionId,
      authorizingHuman: {
        actorId: access.humanActorId,
        actorKey: access.humanActorKey,
        organizationId: access.organizationId,
        role: currentMember.role,
        userId: access.userId,
      },
      completionHash: fingerprint.completionHash,
      disposition: parsed.disposition,
      outcome: 'task_questions_resolved',
      producerContext: {
        actorId: access.cmoActorId,
        actorKey: access.cmoActorKey,
        callId: access.callId,
        conversationId: access.conversationId,
        sessionId: access.sessionId,
        turnId: access.turnId,
      },
      rationale: parsed.rationale,
      taskId: parsed.taskId,
    }
    await transaction.insert(actions).values({
      actorId: access.cmoActorId,
      brandId: access.brandId,
      callId: access.callId,
      conversationId: access.conversationId,
      effectClass: 'graph-internal',
      id: actionId,
      intentId: task.intentId,
      operationKey: fingerprint.operationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale: parsed.rationale,
      requestHash: fingerprint.requestHash,
      sessionId: access.sessionId,
      taskId: parsed.taskId,
      turnId: access.turnId,
      type: 'task_questions_resolved',
    })
    return receipt
  })
}
