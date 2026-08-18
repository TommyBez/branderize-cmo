import { randomUUID } from 'node:crypto'

import {
  type ProductMarketerCompletion,
  type ProductMarketerPayload,
  productMarketerCompletionSchema,
  productMarketerPayloadSchema,
} from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import {
  actions,
  actors,
  intents,
  objects,
  tasks,
} from '@repo/db/schema/domain'
import { evaluatePolicy } from '@repo/policy'
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'

import { canonicalize, operationKey, requestHash } from './canonical'
import {
  type MemberRole,
  memberRoleSchema,
  type TrustedCmoTurnAccess,
  type TrustedTaskExecution,
} from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  requireCurrentBrandMember,
  requireMutationRole,
  requireTrustedAgentActor,
  requireTrustedCmoTurn,
  requireTrustedHumanActor,
} from './internal'
import { BRAND_CONTEXT_SINGLETON_KEY } from './objects'
import { readActionReceipt } from './receipts'

export const PRODUCT_MARKETER_TASK_KIND =
  'product-marketer.brand-context.v1' as const
export const PRODUCT_MARKETER_WORKER_KEY = 'product-marketer' as const
export const AGENT_DELIVERY_RECOVERY_WINDOW_MS = 5 * 60 * 1000

const DELIVERY_FAILED_OUTCOME_CODE = 'DELIVERY_FAILED' as const

const nonBlankSchema = z.string().trim().min(1)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const requestSpecialistWorkInputSchema = z
  .object({
    intentId: z.uuid(),
    kind: z.literal(PRODUCT_MARKETER_TASK_KIND),
    payload: productMarketerPayloadSchema,
    requestId: nonBlankSchema.max(500),
  })
  .strict()

const createdSpecialistWorkReceiptSchema = z
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

const requestSpecialistWorkReceiptSchema = z.discriminatedUnion('disposition', [
  createdSpecialistWorkReceiptSchema,
  observedSpecialistWorkReceiptSchema,
])

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
  completionHash: sha256Schema,
  outcome: z.literal('task_questions_resolved'),
  producerContext: taskQuestionProducerContextSchema,
  rationale: nonBlankSchema.max(3000),
  taskId: z.uuid(),
}

const taskQuestionsResolvedReceiptSchema = z.discriminatedUnion('disposition', [
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
])

const intentSnapshotSchema = z
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
export type TaskQuestionsResolvedReceipt = z.infer<
  typeof taskQuestionsResolvedReceiptSchema
>

type ParsedResolveTaskQuestionsInput = z.output<
  typeof resolveTaskQuestionsInputSchema
>

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
  const parsedCompletionHash = sha256Schema.parse(completionHash)
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

export interface ClaimedProductMarketerTask {
  readonly agentActorId: string
  readonly agentActorKey: 'agent:product-marketer'
  readonly brandContextContent: unknown
  readonly brandContextObjectId: string
  readonly brandId: string
  readonly intentSnapshot: z.infer<typeof intentSnapshotSchema>
  readonly kind: typeof PRODUCT_MARKETER_TASK_KIND
  readonly payload: ProductMarketerPayload
  readonly startedAt: Date
  readonly taskId: string
  readonly workerKey: typeof PRODUCT_MARKETER_WORKER_KEY
}

export interface ProductMarketerDeliveryFailure {
  readonly outcome: 'delivery_failed' | 'not_unbound_running'
  readonly taskId: string
}

export interface StagedTaskCompletion {
  readonly completion: ProductMarketerCompletion
  readonly outcome: 'completion_staged'
  readonly taskId: string
}

const validateCompletionOutput = async ({
  completion,
  execution,
  resultActionId,
  transaction,
}: {
  readonly completion: ProductMarketerCompletion
  readonly execution: TrustedTaskExecution
  readonly resultActionId: string | null
  readonly transaction: BrainTransaction
}): Promise<void> => {
  if (completion.status !== 'completed') {
    if (resultActionId !== null) {
      return fail(
        'invalid_completion',
        'Partial or blocked completion cannot retain a task-produced Object'
      )
    }
    return
  }

  const [outputId] = completion.outputObjectIds
  if (outputId === undefined) {
    return fail(
      'invalid_output',
      'Completed task is missing its required output'
    )
  }
  const [output] = await transaction
    .select({ actionId: actions.id, objectId: objects.id })
    .from(objects)
    .innerJoin(
      actions,
      and(
        eq(actions.id, objects.producedBy),
        eq(actions.brandId, objects.brandId)
      )
    )
    .where(
      and(
        eq(objects.id, outputId),
        eq(objects.brandId, execution.brandId),
        eq(objects.type, 'brand_context'),
        eq(actions.taskId, execution.taskId)
      )
    )
    .limit(1)
  if (
    output === undefined ||
    resultActionId === null ||
    output.actionId !== resultActionId
  ) {
    return fail(
      'invalid_output',
      'Completed task output must be the task-produced Brand Context'
    )
  }
}

const timestampsMatch = (left: Date | null, right: Date): boolean =>
  left !== null && left.getTime() === right.getTime()

const asStructureList = (value: unknown): readonly unknown[] | null =>
  Array.isArray(value) && value.length > 0 ? value : null

const observeActiveProductMarketerTask = async (
  transaction: BrainTransaction,
  brandId: string
): Promise<RequestSpecialistWorkReceipt | null> => {
  const [activeTask] = await transaction
    .select({ id: tasks.id, intentSnapshot: tasks.intentSnapshot })
    .from(tasks)
    .where(
      and(
        eq(tasks.brandId, brandId),
        eq(tasks.kind, PRODUCT_MARKETER_TASK_KIND),
        eq(tasks.subjectKey, `${PRODUCT_MARKETER_WORKER_KEY}:brand-context`),
        inArray(tasks.status, ['queued', 'running'])
      )
    )
    .for('share')
    .limit(1)
  if (activeTask === undefined) {
    return null
  }
  const intentSnapshot = intentSnapshotSchema.safeParse(
    activeTask.intentSnapshot
  )
  if (!intentSnapshot.success) {
    return fail(
      'invalid_task',
      'The active Product Marketer task has an invalid Intent snapshot'
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
  const receiptOperationKey = operationKey(
    'request-specialist-work:product-marketer',
    parsed.requestId
  )
  const semanticHash = requestHash({
    brandId: access.brandId,
    cmoActorId: access.cmoActorId,
    conversationId: access.conversationId,
    intentId: parsed.intentId,
    kind: parsed.kind,
    payload: parsed.payload,
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

    const acceptanceCriteria = asStructureList(intent.acceptanceCriteria)
    const constraints = asStructureList(intent.constraints)
    const policy = evaluatePolicy({
      actor: { actorKey: access.cmoActorKey, kind: 'agent' },
      authorization: {
        humanActorKey: access.humanActorKey,
        kind: 'member',
        membership: { kind: 'current', role: currentMember.role },
        mode: 'cmo-transduction',
      },
      capability: {
        capabilityKey: `task:${PRODUCT_MARKETER_TASK_KIND}`,
        kind: 'granted',
      },
      currentBrandRestrictions: [],
      effect: { phase: 'graph-internal' },
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
    const observedTask = await observeActiveProductMarketerTask(
      transaction,
      access.brandId
    )
    if (observedTask !== null) {
      return observedTask
    }

    const intentSnapshot = intentSnapshotSchema.parse({
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
        activation: 'automatic',
        brandId: access.brandId,
        creationHash: semanticHash,
        executionMode: 'agent',
        id: taskId,
        idempotencyKey: `task:${requestHash({
          brandId: access.brandId,
          receiptOperationKey,
        })}`,
        intentId: intent.id,
        intentSnapshot,
        kind: PRODUCT_MARKETER_TASK_KIND,
        payload: parsed.payload,
        payloadHash: requestHash(parsed.payload),
        status: 'queued',
        subjectKey: `${PRODUCT_MARKETER_WORKER_KEY}:brand-context`,
        workerKey: PRODUCT_MARKETER_WORKER_KEY,
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
      const concurrentWinner = await observeActiveProductMarketerTask(
        transaction,
        access.brandId
      )
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
      effectClass: 'graph-internal',
      id: actionId,
      intentId: intent.id,
      operationKey: receiptOperationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale:
        'Request the allowlisted Product Marketer task for this Intent',
      requestHash: semanticHash,
      sessionId: access.sessionId,
      taskId,
      type: 'specialist_work_requested',
    })
    return receipt
  })
}

export const claimProductMarketerTask = async ({
  database,
  now,
}: {
  readonly database: Database
  readonly now: Date
}): Promise<ClaimedProductMarketerTask | null> =>
  await database.transaction(async (transaction) => {
    const recoveryCutoff = new Date(
      now.getTime() - AGENT_DELIVERY_RECOVERY_WINDOW_MS
    )
    await transaction
      .update(tasks)
      .set({
        completion: null,
        nextDueAt: null,
        nextPayload: null,
        nextRationale: null,
        startedAt: null,
        status: 'queued',
      })
      .where(
        and(
          eq(tasks.executionMode, 'agent'),
          eq(tasks.activation, 'automatic'),
          eq(tasks.workerKey, PRODUCT_MARKETER_WORKER_KEY),
          eq(tasks.kind, PRODUCT_MARKETER_TASK_KIND),
          eq(tasks.status, 'running'),
          isNull(tasks.sessionId),
          lte(tasks.startedAt, recoveryCutoff)
        )
      )

    const [task] = await transaction
      .select({
        brandId: tasks.brandId,
        id: tasks.id,
        intentSnapshot: tasks.intentSnapshot,
        kind: tasks.kind,
        payload: tasks.payload,
        workerKey: tasks.workerKey,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.executionMode, 'agent'),
          eq(tasks.activation, 'automatic'),
          eq(tasks.workerKey, PRODUCT_MARKETER_WORKER_KEY),
          eq(tasks.kind, PRODUCT_MARKETER_TASK_KIND),
          eq(tasks.status, 'queued'),
          isNull(tasks.sessionId),
          lte(tasks.dueAt, now),
          sql`(SELECT coalesce(sum(cl.amount), 0) FROM credit_ledger AS cl WHERE cl.brand_id = ${tasks.brandId}) > 0`
        )
      )
      .orderBy(tasks.createdAt, tasks.id)
      .for('update', { skipLocked: true })
      .limit(1)
    if (task === undefined) {
      return null
    }

    const intentSnapshot = intentSnapshotSchema.safeParse(task.intentSnapshot)
    const payload = productMarketerPayloadSchema.safeParse(task.payload)
    if (!(intentSnapshot.success && payload.success)) {
      return fail('invalid_task', 'Queued Product Marketer task is malformed')
    }
    const [brandContext] = await transaction
      .select({ content: objects.content, id: objects.id })
      .from(objects)
      .where(
        and(
          eq(objects.brandId, task.brandId),
          eq(objects.singletonKey, BRAND_CONTEXT_SINGLETON_KEY),
          eq(objects.status, 'active')
        )
      )
      .for('share')
      .limit(1)
    if (brandContext === undefined) {
      return fail('invalid_task', 'Product Marketer task has no Brand Context')
    }
    const [agentActor] = await transaction
      .select({ actorKey: actors.actorKey, id: actors.id, type: actors.type })
      .from(actors)
      .where(eq(actors.actorKey, 'agent:product-marketer'))
      .for('share')
      .limit(1)
    if (
      agentActor === undefined ||
      agentActor.type !== 'agent' ||
      agentActor.actorKey !== 'agent:product-marketer'
    ) {
      return fail(
        'invalid_task',
        'Product Marketer task has no trusted Agent Actor'
      )
    }

    const [claimed] = await transaction
      .update(tasks)
      .set({
        startedAt: now,
        status: 'running',
      })
      .where(
        and(
          eq(tasks.id, task.id),
          eq(tasks.brandId, task.brandId),
          eq(tasks.status, 'queued')
        )
      )
      .returning({ id: tasks.id, startedAt: tasks.startedAt })
    if (claimed === undefined) {
      return fail('already_claimed', 'Task claim lost its queue race')
    }
    if (claimed.startedAt === null) {
      return fail('invalid_task', 'Claimed task has no execution generation')
    }

    return {
      agentActorId: agentActor.id,
      agentActorKey: 'agent:product-marketer',
      brandContextContent: brandContext.content,
      brandContextObjectId: brandContext.id,
      brandId: task.brandId,
      intentSnapshot: intentSnapshot.data,
      kind: PRODUCT_MARKETER_TASK_KIND,
      payload: payload.data,
      startedAt: claimed.startedAt,
      taskId: task.id,
      workerKey: PRODUCT_MARKETER_WORKER_KEY,
    }
  })

export const failProductMarketerDelivery = async ({
  claim,
  database,
  now,
}: {
  readonly claim: ClaimedProductMarketerTask
  readonly database: Database
  readonly now: Date
}): Promise<ProductMarketerDeliveryFailure> =>
  await database.transaction(async (transaction) => {
    await requireTrustedAgentActor(transaction, {
      actorId: claim.agentActorId,
      actorKey: claim.agentActorKey,
    })
    const [task] = await transaction
      .select({
        kind: tasks.kind,
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
        status: tasks.status,
        workerKey: tasks.workerKey,
      })
      .from(tasks)
      .where(and(eq(tasks.id, claim.taskId), eq(tasks.brandId, claim.brandId)))
      .for('update')
      .limit(1)
    if (task === undefined) {
      return fail('task_not_found', 'Delivery failure target is missing')
    }
    if (
      task.kind !== PRODUCT_MARKETER_TASK_KIND ||
      task.workerKey !== PRODUCT_MARKETER_WORKER_KEY ||
      claim.kind !== PRODUCT_MARKETER_TASK_KIND ||
      claim.workerKey !== PRODUCT_MARKETER_WORKER_KEY
    ) {
      return fail('invalid_task', 'Delivery failure binding is invalid')
    }
    if (
      task.status !== 'running' ||
      task.sessionId !== null ||
      !timestampsMatch(task.startedAt, claim.startedAt)
    ) {
      return {
        outcome: 'not_unbound_running',
        taskId: claim.taskId,
      }
    }

    const [failed] = await transaction
      .update(tasks)
      .set({
        completion: null,
        finishedAt: now,
        nextDueAt: null,
        nextPayload: null,
        nextRationale: null,
        outcomeCode: DELIVERY_FAILED_OUTCOME_CODE,
        status: 'failed',
      })
      .where(
        and(
          eq(tasks.id, claim.taskId),
          eq(tasks.brandId, claim.brandId),
          eq(tasks.workerKey, PRODUCT_MARKETER_WORKER_KEY),
          eq(tasks.kind, PRODUCT_MARKETER_TASK_KIND),
          eq(tasks.status, 'running'),
          eq(tasks.startedAt, claim.startedAt),
          isNull(tasks.sessionId)
        )
      )
      .returning({ id: tasks.id })
    if (failed === undefined) {
      return {
        outcome: 'not_unbound_running',
        taskId: claim.taskId,
      }
    }
    return {
      outcome: 'delivery_failed',
      taskId: failed.id,
    }
  })

export const bindTaskSession = async ({
  database,
  execution,
}: {
  readonly database: Database
  readonly execution: TrustedTaskExecution
}): Promise<void> => {
  await database.transaction(async (transaction) => {
    await requireTrustedAgentActor(transaction, {
      actorId: execution.agentActorId,
      actorKey: execution.agentActorKey,
    })
    const [task] = await transaction
      .select({
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
        status: tasks.status,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId),
          eq(tasks.workerKey, execution.workerKey)
        )
      )
      .for('update')
      .limit(1)
    if (task === undefined) {
      return fail('task_not_found', 'Task session binding target is missing')
    }
    if (!timestampsMatch(task.startedAt, execution.startedAt)) {
      return fail('already_claimed', 'Task execution generation is stale')
    }
    if (task.sessionId === execution.sessionId) {
      return
    }
    if (task.status !== 'running' || task.sessionId !== null) {
      return fail(
        'already_claimed',
        'Task already has an authoritative session'
      )
    }
    const [bound] = await transaction
      .update(tasks)
      .set({ sessionId: execution.sessionId })
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId),
          eq(tasks.status, 'running'),
          eq(tasks.startedAt, execution.startedAt),
          isNull(tasks.sessionId)
        )
      )
      .returning({ id: tasks.id })
    if (bound === undefined) {
      return fail('already_claimed', 'Task session binding lost its race')
    }
  })
}

export const finishTask = async ({
  completion,
  database,
  execution,
}: {
  readonly completion: ProductMarketerCompletion
  readonly database: Database
  readonly execution: TrustedTaskExecution
}): Promise<StagedTaskCompletion> => {
  const parsedCompletion = productMarketerCompletionSchema.parse(completion)
  return await database.transaction(async (transaction) => {
    await requireTrustedAgentActor(transaction, {
      actorId: execution.agentActorId,
      actorKey: execution.agentActorKey,
    })
    const [task] = await transaction
      .select({
        completion: tasks.completion,
        resultActionId: tasks.resultActionId,
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
        status: tasks.status,
        workerKey: tasks.workerKey,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId)
        )
      )
      .for('update')
      .limit(1)
    if (task === undefined) {
      return fail('task_not_found', 'Task completion target is missing')
    }
    const bindingMatches =
      task.workerKey === execution.workerKey &&
      task.workerKey === PRODUCT_MARKETER_WORKER_KEY &&
      timestampsMatch(task.startedAt, execution.startedAt) &&
      task.sessionId === execution.sessionId
    if (!bindingMatches) {
      return fail('invalid_task', 'Task completion binding is invalid')
    }

    if (task.completion !== null) {
      const existing = productMarketerCompletionSchema.safeParse(
        task.completion
      )
      if (
        !existing.success ||
        canonicalize(existing.data) !== canonicalize(parsedCompletion)
      ) {
        return fail(
          'completion_conflict',
          'Task completion was already filled with different semantics'
        )
      }
      return {
        completion: existing.data,
        outcome: 'completion_staged',
        taskId: execution.taskId,
      }
    }
    if (task.status !== 'running') {
      return fail('task_not_running', 'Only a running task accepts completion')
    }

    await validateCompletionOutput({
      completion: parsedCompletion,
      execution,
      resultActionId: task.resultActionId,
      transaction,
    })

    const [staged] = await transaction
      .update(tasks)
      .set({ completion: parsedCompletion })
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId),
          eq(tasks.status, 'running'),
          eq(tasks.startedAt, execution.startedAt),
          isNull(tasks.completion)
        )
      )
      .returning({ id: tasks.id })
    if (staged === undefined) {
      return fail('completion_conflict', 'Task completion lost its fill race')
    }
    return {
      completion: parsedCompletion,
      outcome: 'completion_staged',
      taskId: execution.taskId,
    }
  })
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
        status: tasks.status,
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
    const completion = productMarketerCompletionSchema.safeParse(
      task.completion
    )
    if (
      task.status !== 'succeeded' ||
      !completion.success ||
      completion.data.status === 'completed'
    ) {
      return fail('invalid_task', 'Task has no settled open-question bundle')
    }
    if (requestHash(completion.data) !== fingerprint.completionHash) {
      return fail(
        'operation_conflict',
        'Task completion changed while resolving its question bundle'
      )
    }
    const intentSnapshot = intentSnapshotSchema.safeParse(task.intentSnapshot)
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
        capabilityKey: `task:${PRODUCT_MARKETER_TASK_KIND}:resolve-questions`,
        kind: 'granted',
      },
      currentBrandRestrictions: [],
      effect: { phase: 'graph-internal' },
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
      type: 'task_questions_resolved',
    })
    return receipt
  })
}
