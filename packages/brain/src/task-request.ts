import { randomUUID } from 'node:crypto'

import { getTaskKind, type RegisteredTaskKindKey } from '@repo/agents'
import { taskIntentSnapshotSchema } from '@repo/agents/task-snapshot'
import type { Database } from '@repo/db/client'
import { actions, intents, tasks } from '@repo/db/schema/domain'
import { evaluatePolicy } from '@repo/policy'
import { and, eq, inArray } from 'drizzle-orm'

import { operationKey, requestHash } from './canonical'
import type { TrustedCmoTurnAccess } from './context'
import { fail } from './errors'
import { intentStructureListSchema } from './intents'
import {
  type BrainTransaction,
  requireCurrentBrandMember,
  requireMutationRole,
  requireTrustedCmoTurn,
  requireTrustedHumanActor,
} from './internal'
import { readActionReceipt } from './receipts'
import {
  createdSpecialistWorkReceiptSchema,
  type RequestSpecialistWorkInput,
  type RequestSpecialistWorkReceipt,
  requestSpecialistWorkInputSchema,
} from './task-contracts'

export const observeActiveSpecialistTask = async (
  transaction: BrainTransaction,
  input: {
    readonly brandId: string
    readonly kind: RegisteredTaskKindKey
    readonly subjectKey: string
  }
): Promise<RequestSpecialistWorkReceipt | null> => {
  const [activeTask] = await transaction
    .select({ id: tasks.id, intentSnapshot: tasks.intentSnapshot })
    .from(tasks)
    .where(
      and(
        eq(tasks.brandId, input.brandId),
        eq(tasks.kind, input.kind),
        eq(tasks.subjectKey, input.subjectKey),
        inArray(tasks.status, ['queued', 'running'])
      )
    )
    .for('share')
    .limit(1)
  if (activeTask === undefined) {
    return null
  }
  const intentSnapshot = taskIntentSnapshotSchema.safeParse(
    activeTask.intentSnapshot
  )
  if (!intentSnapshot.success) {
    return fail(
      'invalid_task',
      'The active specialist task has an invalid Intent snapshot'
    )
  }
  return {
    disposition: 'already_active',
    intentId: intentSnapshot.data.intent_id,
    intentRevision: intentSnapshot.data.intent_revision,
    outcome: 'specialist_work_observed',
    taskId: activeTask.id,
  }
}

export const requestSpecialistWork = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedCmoTurnAccess
  readonly database: Database
  readonly input: RequestSpecialistWorkInput
}): Promise<RequestSpecialistWorkReceipt> => {
  const parsed = requestSpecialistWorkInputSchema.parse(input)
  const taskKind = getTaskKind(parsed.kind)
  if (taskKind.activation === 'human') {
    return fail(
      'invalid_task',
      'Human-activation commitment kinds cannot be requested as specialist work'
    )
  }
  if (
    taskKind.executionMode !== 'agent' ||
    taskKind.activation !== 'automatic' ||
    !taskKind.schedulableBy.includes('agent')
  ) {
    return fail(
      'invalid_task',
      'The registered task kind cannot be requested by an agent'
    )
  }
  const payload = taskKind.briefSchema.parse(parsed.payload)
  const subjectKey = taskKind.subjectKey(payload)
  const receiptOperationKey = operationKey(
    `request-specialist-work:${taskKind.kind}`,
    parsed.requestId
  )
  const semanticHash = requestHash({
    brandId: access.brandId,
    cmoActorId: access.cmoActorId,
    conversationId: access.conversationId,
    intentId: parsed.intentId,
    kind: parsed.kind,
    payload,
    sessionId: access.sessionId,
    turnId: access.turnId,
    userId: access.userId,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    await requireTrustedHumanActor(transaction, access)
    await requireTrustedCmoTurn(transaction, access)
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: createdSpecialistWorkReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    requireMutationRole(currentMember.role)
    const [intent] = await transaction
      .select({
        acceptanceCriteria: intents.acceptanceCriteria,
        constraints: intents.constraints,
        id: intents.id,
        revision: intents.revision,
        statement: intents.statement,
        status: intents.status,
      })
      .from(intents)
      .where(
        and(
          eq(intents.brandId, access.brandId),
          eq(intents.id, parsed.intentId)
        )
      )
      .for('update')
      .limit(1)
    if (intent === undefined) {
      return fail('intent_not_found', 'Specialist work Intent does not exist')
    }
    if (intent.status !== 'active') {
      return fail(
        'intent_not_active',
        'Specialist work requires an active Intent'
      )
    }

    const acceptanceCriteria = intentStructureListSchema
      .nullable()
      .parse(intent.acceptanceCriteria)
    const constraints = intentStructureListSchema
      .nullable()
      .parse(intent.constraints)
    const policy = evaluatePolicy({
      actor: { actorKey: access.cmoActorKey, kind: 'agent' },
      authorization: {
        humanActorKey: access.humanActorKey,
        kind: 'member',
        membership: { kind: 'current', role: currentMember.role },
        mode: 'cmo-transduction',
      },
      capability: {
        capabilityKey: `task:${taskKind.kind}`,
        kind: 'granted',
      },
      currentBrandRestrictions: [],
      effect: { phase: taskKind.effectPhase },
      origin: {
        intent: {
          acceptanceCriteria,
          brandId: access.brandId,
          constraints,
          intentId: intent.id,
          preauthorizations: [],
          revision: intent.revision,
          status: intent.status,
        },
        kind: 'new-intent-work',
      },
    })
    if (policy.verdict !== 'allowed') {
      return fail(
        'access_denied',
        `Policy denied specialist work: ${policy.reason}`
      )
    }
    const observedTask = await observeActiveSpecialistTask(transaction, {
      brandId: access.brandId,
      kind: taskKind.kind,
      subjectKey,
    })
    if (observedTask !== null) {
      return observedTask
    }

    const intentSnapshot = taskIntentSnapshotSchema.parse({
      acceptance_criteria: acceptanceCriteria,
      brand_id: access.brandId,
      constraints,
      intent_id: intent.id,
      intent_revision: intent.revision,
      preauthorizations: policy.selectedPreauthorizations,
      statement: intent.statement,
    })
    const taskId = randomUUID()
    const actionId = randomUUID()
    const receipt: RequestSpecialistWorkReceipt = {
      actionId,
      disposition: 'created',
      intentId: intent.id,
      intentRevision: intent.revision,
      outcome: 'specialist_work_requested',
      taskId,
    }
    const [insertedTask] = await transaction
      .insert(tasks)
      .values({
        activation: taskKind.activation,
        brandId: access.brandId,
        creationHash: semanticHash,
        executionMode: taskKind.executionMode,
        id: taskId,
        idempotencyKey: `task:${requestHash({
          brandId: access.brandId,
          receiptOperationKey,
        })}`,
        intentId: intent.id,
        intentSnapshot,
        kind: taskKind.kind,
        payload,
        payloadHash: requestHash(payload),
        status: 'queued',
        subjectKey,
        workerKey: taskKind.workerKey,
      })
      .onConflictDoNothing()
      .returning({ id: tasks.id })
    if (insertedTask === undefined) {
      const concurrentReplay = await readActionReceipt({
        brandId: access.brandId,
        operationKey: receiptOperationKey,
        receiptSchema: createdSpecialistWorkReceiptSchema,
        requestHash: semanticHash,
        transaction,
      })
      if (concurrentReplay !== null) {
        return concurrentReplay
      }
      const concurrentWinner = await observeActiveSpecialistTask(transaction, {
        brandId: access.brandId,
        kind: taskKind.kind,
        subjectKey,
      })
      if (concurrentWinner !== null) {
        return concurrentWinner
      }
      return fail(
        'operation_conflict',
        'Task creation conflicted without an observable canonical winner'
      )
    }
    await transaction.insert(actions).values({
      actorId: access.cmoActorId,
      brandId: access.brandId,
      callId: access.callId,
      conversationId: access.conversationId,
      effectClass: 'graph-internal',
      id: actionId,
      intentId: intent.id,
      operationKey: receiptOperationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale: `Request the registered ${taskKind.kind} task for this Intent`,
      requestHash: semanticHash,
      sessionId: access.sessionId,
      taskId,
      turnId: access.turnId,
      type: 'specialist_work_requested',
    })
    return receipt
  })
}
