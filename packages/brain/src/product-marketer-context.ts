import { randomUUID } from 'node:crypto'

import {
  PRODUCT_MARKETER_TASK_KIND,
  PRODUCT_MARKETER_WORKER_KEY,
} from '@repo/agents/tasks'
import type { Database } from '@repo/db/client'
import { actions, actors, objects, tasks } from '@repo/db/schema/domain'
import { evaluatePolicy } from '@repo/policy'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { canonicalize, operationKey, requestHash } from './canonical'
import type { TrustedTaskExecution } from './context'
import { fail } from './errors'
import { requireTrustedAgentActor } from './internal'
import {
  BRAND_CONTEXT_SINGLETON_KEY,
  CONTEXT_DEV_ACTOR_KEY,
} from './object-contracts'
import { readActionReceipt } from './receipts'

const nonBlankSchema = z.string().trim().min(1)
const PRODUCT_MARKETER_ACTOR_KEY = `agent:${PRODUCT_MARKETER_WORKER_KEY}`

export const productMarketerContextContentSchema = z
  .object({
    audiences: z
      .array(
        z
          .object({
            need: nonBlankSchema.max(1000),
            segment: nonBlankSchema.max(300),
          })
          .strict()
      )
      .min(1)
      .max(12),
    category: nonBlankSchema.max(300),
    differentiators: z.array(nonBlankSchema.max(500)).min(1).max(12),
    risks: z.array(nonBlankSchema.max(500)).max(12),
    summary: nonBlankSchema.max(3000),
    valueProposition: nonBlankSchema.max(2000),
  })
  .strict()

const productMarketerObjectReceiptSchema = z
  .object({
    actionId: z.uuid(),
    brandContextObjectId: z.uuid(),
    outcome: z.literal('brand_context_enriched'),
    supersededObjectId: z.uuid(),
    taskId: z.uuid(),
  })
  .strict()

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

export type ProductMarketerContextContent = z.infer<
  typeof productMarketerContextContentSchema
>
export type ProductMarketerObjectReceipt = z.infer<
  typeof productMarketerObjectReceiptSchema
>

const requireSupersedableBrandContextHead = (head: {
  readonly producerActorKey: string
  readonly producerActorType: 'agent' | 'human' | 'system'
}): void => {
  if (
    head.producerActorType === 'system' &&
    head.producerActorKey === CONTEXT_DEV_ACTOR_KEY
  ) {
    return
  }
  if (
    head.producerActorType === 'agent' &&
    head.producerActorKey === PRODUCT_MARKETER_ACTOR_KEY
  ) {
    return
  }
  fail(
    'access_denied',
    'Product Marketer cannot supersede a human or unknown Brand Context head'
  )
}

const hasProductMarketerBinding = (
  task: {
    readonly brandId: string
    readonly kind: string
    readonly sessionId: string | null
    readonly startedAt: Date | null
    readonly workerKey: string
  },
  execution: TrustedTaskExecution
): boolean =>
  task.brandId === execution.brandId &&
  task.kind === PRODUCT_MARKETER_TASK_KIND &&
  task.workerKey === PRODUCT_MARKETER_WORKER_KEY &&
  execution.workerKey === PRODUCT_MARKETER_WORKER_KEY &&
  task.startedAt !== null &&
  task.startedAt.getTime() === execution.startedAt.getTime() &&
  task.sessionId === execution.rootSessionId

export const produceProductMarketerContext = async ({
  content,
  database,
  execution,
  expectedBrandContextObjectId,
  requestId,
}: {
  readonly content: ProductMarketerContextContent
  readonly database: Database
  readonly execution: TrustedTaskExecution
  readonly expectedBrandContextObjectId: string
  readonly requestId: string
}): Promise<ProductMarketerObjectReceipt> => {
  const parsedContent = productMarketerContextContentSchema.parse(content)
  const parsedExpectedHead = z.uuid().parse(expectedBrandContextObjectId)
  const parsedRequestId = nonBlankSchema.max(500).parse(requestId)
  const receiptOperationKey = operationKey(
    `product-marketer-output:${execution.taskId}`,
    parsedRequestId
  )
  const semanticHash = requestHash({
    content: parsedContent,
    expectedBrandContextObjectId: parsedExpectedHead,
    sessionId: execution.sessionId,
    startedAt: execution.startedAt.toISOString(),
    taskId: execution.taskId,
  })

  return await database.transaction(async (transaction) => {
    await requireTrustedAgentActor(transaction, {
      actorId: execution.agentActorId,
      actorKey: execution.agentActorKey,
    })
    const [task] = await transaction
      .select({
        brandId: tasks.brandId,
        completion: tasks.completion,
        intentId: tasks.intentId,
        intentSnapshot: tasks.intentSnapshot,
        kind: tasks.kind,
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
      return fail('task_not_found', 'Product Marketer task does not exist')
    }
    if (!hasProductMarketerBinding(task, execution)) {
      return fail('invalid_task', 'Product Marketer task binding is invalid')
    }

    const replay = await readActionReceipt({
      brandId: execution.brandId,
      operationKey: receiptOperationKey,
      receiptSchema: productMarketerObjectReceiptSchema,
      requestHash: semanticHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    if (
      task.status !== 'running' ||
      task.completion !== null ||
      task.resultActionId !== null
    ) {
      return fail(
        'task_not_running',
        'Task cannot accept a new canonical output'
      )
    }
    const intentSnapshot = intentSnapshotSchema.safeParse(task.intentSnapshot)
    if (
      !intentSnapshot.success ||
      task.intentId !== intentSnapshot.data.intent_id ||
      intentSnapshot.data.brand_id !== execution.brandId
    ) {
      return fail('invalid_task', 'Task Intent snapshot is invalid')
    }

    const [currentHead] = await transaction
      .select({
        id: objects.id,
        producerActorKey: actors.actorKey,
        producerActorType: actors.type,
      })
      .from(objects)
      .innerJoin(
        actions,
        and(
          eq(actions.brandId, objects.brandId),
          eq(actions.id, objects.producedBy)
        )
      )
      .innerJoin(actors, eq(actors.id, actions.actorId))
      .where(
        and(
          eq(objects.brandId, execution.brandId),
          eq(objects.singletonKey, BRAND_CONTEXT_SINGLETON_KEY),
          eq(objects.status, 'active')
        )
      )
      .for('update')
      .limit(1)
    if (currentHead?.id !== parsedExpectedHead) {
      return fail('stale_head', 'Brand Context changed during task execution')
    }
    requireSupersedableBrandContextHead(currentHead)

    const policy = evaluatePolicy({
      actor: { actorKey: execution.agentActorKey, kind: 'agent' },
      authorization: { kind: 'autonomous' },
      capability: {
        capabilityKey: `task:${PRODUCT_MARKETER_TASK_KIND}`,
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
        `Policy denied Product Marketer output: ${policy.reason}`
      )
    }

    const actionId = randomUUID()
    const brandContextObjectId = randomUUID()
    const receipt: ProductMarketerObjectReceipt = {
      actionId,
      brandContextObjectId,
      outcome: 'brand_context_enriched',
      supersededObjectId: currentHead.id,
      taskId: execution.taskId,
    }
    await transaction.insert(actions).values({
      actorId: execution.agentActorId,
      brandId: execution.brandId,
      effectClass: 'graph-internal',
      id: actionId,
      intentId: task.intentId,
      operationKey: receiptOperationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale:
        'Enrich the canonical Brand Context for the accepted Intent snapshot',
      requestHash: semanticHash,
      sessionId: execution.sessionId,
      taskId: execution.taskId,
      type: 'brand_context_enriched',
    })
    const supersededAt = new Date()
    const [superseded] = await transaction
      .update(objects)
      .set({
        status: 'superseded',
        supersededAt,
        supersededBy: brandContextObjectId,
      })
      .where(
        and(
          eq(objects.brandId, execution.brandId),
          eq(objects.id, parsedExpectedHead),
          eq(objects.status, 'active')
        )
      )
      .returning({ id: objects.id })
    if (superseded === undefined) {
      return fail('stale_head', 'Brand Context supersession lost its race')
    }

    const nextContent = {
      basisObjectId: currentHead.id,
      report: parsedContent,
      source: 'product-marketer',
      taskId: execution.taskId,
    }
    await transaction.insert(objects).values({
      brandId: execution.brandId,
      content: nextContent,
      contentText: canonicalize(nextContent),
      id: brandContextObjectId,
      producedBy: actionId,
      singletonKey: BRAND_CONTEXT_SINGLETON_KEY,
      status: 'active',
      type: 'brand_context',
    })
    const [boundTask] = await transaction
      .update(tasks)
      .set({ resultActionId: actionId })
      .where(
        and(
          eq(tasks.id, execution.taskId),
          eq(tasks.brandId, execution.brandId),
          eq(tasks.status, 'running'),
          eq(tasks.startedAt, execution.startedAt),
          isNull(tasks.resultActionId)
        )
      )
      .returning({ id: tasks.id })
    if (boundTask === undefined) {
      return fail('invalid_task', 'Task output Action binding lost its race')
    }
    return receipt
  })
}
