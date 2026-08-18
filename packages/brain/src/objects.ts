import { randomUUID } from 'node:crypto'

import type { Database } from '@repo/db/client'
import { member } from '@repo/db/schema/auth'
import { actions, actors, brands, objects, tasks } from '@repo/db/schema/domain'
import { evaluatePolicy } from '@repo/policy'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { canonicalize, operationKey, requestHash } from './canonical'
import {
  memberRoleSchema,
  type TrustedMemberAccess,
  type TrustedTaskExecution,
} from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  requireMutationRole,
  requireTrustedAgentActor,
  requireTrustedHumanActor,
} from './internal'
import { readActionReceipt } from './receipts'

export const CONTEXT_BOOTSTRAP_NORMALIZATION = 'context-dev-url-v1' as const
export const BRAND_CONTEXT_SINGLETON_KEY = 'brand-context' as const
export const CONTEXT_BOOTSTRAP_CLAIM_STALE_AFTER_MS = 180_000

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const TRAILING_SLASH_PATTERN = /\/$/u
const nonBlankSchema = z.string().trim().min(1)
const PRODUCT_MARKETER_ACTOR_KEY = 'agent:product-marketer'
const CONTEXT_DEV_ACTOR_KEY = 'system:context-dev'

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

const artifactExtensions = {
  'application/pdf': 'pdf',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
} as const

const artifactContentTypeSchema = z.enum(
  Object.keys(artifactExtensions) as [
    keyof typeof artifactExtensions,
    ...(keyof typeof artifactExtensions)[],
  ]
)

const contextArtifactSchema = z
  .object({
    blobKey: nonBlankSchema.max(512),
    byteSize: z.number().int().positive(),
    contentType: artifactContentTypeSchema,
    finalUrl: z.url(),
    sha256: z.string().regex(SHA256_PATTERN),
    sourceUrl: z.url(),
  })
  .strict()

export const commitContextBootstrapInputSchema = z
  .object({
    artifacts: z.array(contextArtifactSchema).min(1).max(64),
    snapshot: z.record(z.string(), z.json()),
    websiteUrl: z.url(),
  })
  .strict()
  .superRefine((input, context) => {
    const observedKeys = new Set<string>()
    for (const artifact of input.artifacts) {
      if (observedKeys.has(artifact.blobKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Artifact blob keys must be unique',
          path: ['artifacts'],
        })
      }
      observedKeys.add(artifact.blobKey)
    }
  })

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

const contextBootstrapReceiptSchema = z
  .object({
    actionId: z.uuid(),
    artifactObjectIds: z.array(z.uuid()),
    brandContextObjectId: z.uuid(),
    outcome: z.literal('context_bootstrapped'),
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

export interface TrustedContextBootstrap {
  readonly brandId: string
  readonly systemActorId: string
  readonly systemActorKey: 'system:context-dev'
}

export type CommitContextBootstrapInput = z.input<
  typeof commitContextBootstrapInputSchema
>
export type ContextBootstrapReceipt = z.infer<
  typeof contextBootstrapReceiptSchema
>
export type ContextBootstrapClaim =
  | {
      readonly brandId: string
      readonly claimedAt: Date
      readonly kind: 'claimed'
      readonly systemActorId: string
      readonly websiteUrl: string
    }
  | {
      readonly kind: 'replay'
      readonly receipt: ContextBootstrapReceipt
    }
export type ClaimedContextBootstrap = Extract<
  ContextBootstrapClaim,
  { readonly kind: 'claimed' }
>
export type ProductMarketerContextContent = z.infer<
  typeof productMarketerContextContentSchema
>
export type ProductMarketerObjectReceipt = z.infer<
  typeof productMarketerObjectReceiptSchema
>

const normalizedWebsiteUrl = (value: string): string => {
  const url = new URL(value)
  url.hash = ''
  url.hostname = url.hostname.toLowerCase()
  url.searchParams.sort()
  if (url.pathname === '/') {
    url.pathname = ''
  }
  return url.toString().replace(TRAILING_SLASH_PATTERN, '')
}

const contextBootstrapReceiptIdentity = ({
  brandId,
  websiteUrl,
}: {
  readonly brandId: string
  readonly websiteUrl: string
}) => {
  const normalizedUrl = normalizedWebsiteUrl(websiteUrl)
  return {
    normalizedUrl,
    operationKey: operationKey(
      `context-bootstrap:${CONTEXT_BOOTSTRAP_NORMALIZATION}`,
      normalizedUrl
    ),
    requestHash: requestHash({
      brandId,
      normalization: CONTEXT_BOOTSTRAP_NORMALIZATION,
      websiteUrl: normalizedUrl,
    }),
  }
}

const requireSystemActor = async (
  transaction: BrainTransaction,
  access: TrustedContextBootstrap
): Promise<void> => {
  const [actor] = await transaction
    .select({ actorKey: actors.actorKey, type: actors.type })
    .from(actors)
    .where(eq(actors.id, access.systemActorId))
    .for('share')
    .limit(1)
  if (actor?.type !== 'system' || actor.actorKey !== access.systemActorKey) {
    return fail('access_denied', 'The Context.dev System Actor is invalid')
  }
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
  task.kind === 'product-marketer.brand-context.v1' &&
  task.workerKey === 'product-marketer' &&
  execution.workerKey === 'product-marketer' &&
  task.startedAt !== null &&
  task.startedAt.getTime() === execution.startedAt.getTime() &&
  task.sessionId === execution.rootSessionId

export const claimContextBootstrap = async ({
  access,
  database,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
}): Promise<ContextBootstrapClaim> =>
  await database.transaction(async (transaction) => {
    const [authorizedBrand] = await transaction
      .select({
        id: brands.id,
        role: member.role,
        websiteUrl: brands.websiteUrl,
      })
      .from(brands)
      .innerJoin(
        member,
        and(
          eq(member.organizationId, brands.organizationId),
          eq(member.userId, access.userId)
        )
      )
      .where(
        and(
          eq(brands.id, access.brandId),
          eq(brands.organizationId, access.organizationId)
        )
      )
      .for('share', { of: member })
      .limit(1)
    if (authorizedBrand === undefined) {
      return fail(
        'access_denied',
        'The Brand Context import is outside the current organization'
      )
    }

    await requireTrustedHumanActor(transaction, access)
    const identity = contextBootstrapReceiptIdentity({
      brandId: authorizedBrand.id,
      websiteUrl: authorizedBrand.websiteUrl,
    })
    const replay = await readActionReceipt({
      brandId: authorizedBrand.id,
      operationKey: identity.operationKey,
      receiptSchema: contextBootstrapReceiptSchema,
      requestHash: identity.requestHash,
      transaction,
    })
    if (replay !== null) {
      return { kind: 'replay', receipt: replay }
    }

    const [brand] = await transaction
      .select({
        id: brands.id,
        onboardingStatus: brands.onboardingStatus,
        updatedAt: brands.updatedAt,
        websiteUrl: brands.websiteUrl,
      })
      .from(brands)
      .where(
        and(
          eq(brands.id, access.brandId),
          eq(brands.organizationId, access.organizationId)
        )
      )
      .for('update')
      .limit(1)
    if (brand === undefined) {
      return fail('brand_not_found', 'Context bootstrap brand does not exist')
    }
    if (normalizedWebsiteUrl(brand.websiteUrl) !== identity.normalizedUrl) {
      return fail(
        'operation_conflict',
        'The canonical website changed while claiming Context import'
      )
    }
    if (brand.onboardingStatus === 'ready') {
      return fail(
        'stale_head',
        'A canonical Brand Context already exists without its bootstrap receipt'
      )
    }
    requireMutationRole(memberRoleSchema.parse(authorizedBrand.role))

    const claimedAt = new Date()
    const claimAgeMs = claimedAt.getTime() - brand.updatedAt.getTime()
    if (
      brand.onboardingStatus === 'importing' &&
      claimAgeMs < CONTEXT_BOOTSTRAP_CLAIM_STALE_AFTER_MS
    ) {
      return fail(
        'already_claimed',
        'A Brand Context import is already in progress'
      )
    }

    const [activeContext] = await transaction
      .select({ id: objects.id })
      .from(objects)
      .where(
        and(
          eq(objects.brandId, access.brandId),
          eq(objects.singletonKey, BRAND_CONTEXT_SINGLETON_KEY),
          eq(objects.status, 'active')
        )
      )
      .limit(1)
    if (activeContext !== undefined) {
      return fail(
        'stale_head',
        'A canonical Brand Context already exists for this brand'
      )
    }

    const [systemActor] = await transaction
      .select({ id: actors.id, type: actors.type })
      .from(actors)
      .where(eq(actors.actorKey, CONTEXT_DEV_ACTOR_KEY))
      .for('share')
      .limit(1)
    if (systemActor?.type !== 'system') {
      return fail(
        'invalid_operation',
        'The Context.dev System Actor is unavailable'
      )
    }

    const [claimedBrand] = await transaction
      .update(brands)
      .set({ onboardingStatus: 'importing', updatedAt: claimedAt })
      .where(
        and(
          eq(brands.id, brand.id),
          eq(brands.onboardingStatus, brand.onboardingStatus)
        )
      )
      .returning({ claimedAt: brands.updatedAt, id: brands.id })
    if (claimedBrand === undefined) {
      return fail('already_claimed', 'The Brand Context claim lost its race')
    }

    return {
      brandId: brand.id,
      claimedAt: claimedBrand.claimedAt,
      kind: 'claimed',
      systemActorId: systemActor.id,
      websiteUrl: brand.websiteUrl,
    }
  })

export const recoverContextBootstrapClaim = async ({
  access,
  claim,
  database,
}: {
  readonly access: TrustedContextBootstrap
  readonly claim: ClaimedContextBootstrap
  readonly database: Database
}): Promise<void> => {
  await database.transaction(async (transaction) => {
    await requireSystemActor(transaction, access)
    if (access.brandId !== claim.brandId) {
      return fail(
        'access_denied',
        'The Context bootstrap recovery claim belongs to another brand'
      )
    }
    await transaction
      .update(brands)
      .set({ onboardingStatus: 'incomplete' })
      .where(
        and(
          eq(brands.id, claim.brandId),
          eq(brands.onboardingStatus, 'importing'),
          eq(brands.updatedAt, claim.claimedAt)
        )
      )
  })
}

export const commitContextBootstrap = async ({
  access,
  claim,
  database,
  input,
}: {
  readonly access: TrustedContextBootstrap
  readonly claim: ClaimedContextBootstrap
  readonly database: Database
  readonly input: CommitContextBootstrapInput
}): Promise<ContextBootstrapReceipt> => {
  const parsed = commitContextBootstrapInputSchema.parse(input)
  const identity = contextBootstrapReceiptIdentity({
    brandId: access.brandId,
    websiteUrl: parsed.websiteUrl,
  })
  const { normalizedUrl } = identity

  return await database.transaction(async (transaction) => {
    await requireSystemActor(transaction, access)
    const replay = await readActionReceipt({
      brandId: access.brandId,
      operationKey: identity.operationKey,
      receiptSchema: contextBootstrapReceiptSchema,
      requestHash: identity.requestHash,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    const [brand] = await transaction
      .select({
        id: brands.id,
        onboardingStatus: brands.onboardingStatus,
        updatedAt: brands.updatedAt,
        websiteUrl: brands.websiteUrl,
      })
      .from(brands)
      .where(eq(brands.id, access.brandId))
      .for('update')
      .limit(1)
    if (brand === undefined) {
      return fail('brand_not_found', 'Context bootstrap brand does not exist')
    }
    if (normalizedWebsiteUrl(brand.websiteUrl) !== normalizedUrl) {
      return fail(
        'operation_conflict',
        'Context bootstrap website does not match the canonical brand website'
      )
    }
    if (
      claim.brandId !== brand.id ||
      claim.systemActorId !== access.systemActorId ||
      normalizedWebsiteUrl(claim.websiteUrl) !== normalizedUrl ||
      brand.onboardingStatus !== 'importing' ||
      brand.updatedAt.getTime() !== claim.claimedAt.getTime()
    ) {
      return fail(
        'already_claimed',
        'The Brand Context import claim is no longer authoritative'
      )
    }

    const [activeContext] = await transaction
      .select({ id: objects.id })
      .from(objects)
      .where(
        and(
          eq(objects.brandId, access.brandId),
          eq(objects.singletonKey, BRAND_CONTEXT_SINGLETON_KEY),
          eq(objects.status, 'active')
        )
      )
      .for('update')
      .limit(1)
    if (activeContext !== undefined) {
      return fail(
        'stale_head',
        'A canonical Brand Context already exists for this brand'
      )
    }

    for (const artifact of parsed.artifacts) {
      const extension = artifactExtensions[artifact.contentType]
      const expectedKey = `brands/${access.brandId}/artifacts/sha256/${artifact.sha256}.${extension}`
      if (artifact.blobKey !== expectedKey) {
        return fail(
          'invalid_output',
          'Artifact key must match the canonical brand, hash, and content type'
        )
      }
    }

    const actionId = randomUUID()
    const brandContextObjectId = randomUUID()
    const artifactRows = parsed.artifacts.map((artifact) => ({
      artifact,
      objectId: randomUUID(),
    }))
    const receipt: ContextBootstrapReceipt = {
      actionId,
      artifactObjectIds: artifactRows.map(({ objectId }) => objectId),
      brandContextObjectId,
      outcome: 'context_bootstrapped',
    }
    const policy = evaluatePolicy({
      actor: { actorKey: access.systemActorKey, kind: 'system' },
      authorization: {
        kind: 'system-operation',
        operation: 'context-dev-bootstrap',
        systemActorKey: access.systemActorKey,
      },
      capability: { kind: 'not-required' },
      currentBrandRestrictions: [],
      effect: { phase: 'graph-internal' },
      origin: { kind: 'brand-administration' },
    })
    if (policy.verdict !== 'allowed') {
      return fail(
        'access_denied',
        `Policy denied Context bootstrap: ${policy.reason}`
      )
    }

    await transaction.insert(actions).values({
      actorId: access.systemActorId,
      brandId: access.brandId,
      effectClass: 'graph-internal',
      id: actionId,
      operationKey: identity.operationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale: 'Commit the validated Context.dev import and mirrored assets',
      requestHash: identity.requestHash,
      type: 'context_bootstrapped',
    })

    await transaction.insert(objects).values(
      artifactRows.map(({ artifact, objectId }) => ({
        blobByteSize: artifact.byteSize,
        blobContentType: artifact.contentType,
        blobKey: artifact.blobKey,
        blobSha256: artifact.sha256,
        brandId: access.brandId,
        content: {
          finalUrl: artifact.finalUrl,
          kind: 'context-dev-asset',
          sourceUrl: artifact.sourceUrl,
        },
        contentText: `${artifact.sourceUrl}\n${artifact.finalUrl}`,
        id: objectId,
        producedBy: actionId,
        status: 'active' as const,
        type: 'artifact',
      }))
    )

    const brandContextContent = {
      artifactObjectIds: receipt.artifactObjectIds,
      normalization: CONTEXT_BOOTSTRAP_NORMALIZATION,
      snapshot: parsed.snapshot,
      source: 'context.dev',
      websiteUrl: normalizedUrl,
    }
    await transaction.insert(objects).values({
      brandId: access.brandId,
      content: brandContextContent,
      contentText: canonicalize(brandContextContent),
      id: brandContextObjectId,
      producedBy: actionId,
      singletonKey: BRAND_CONTEXT_SINGLETON_KEY,
      status: 'active',
      type: 'brand_context',
    })
    const [readyBrand] = await transaction
      .update(brands)
      .set({ onboardingStatus: 'ready' })
      .where(
        and(
          eq(brands.id, access.brandId),
          eq(brands.onboardingStatus, 'importing'),
          eq(brands.updatedAt, claim.claimedAt)
        )
      )
      .returning({ id: brands.id })
    if (readyBrand === undefined) {
      return fail(
        'already_claimed',
        'The Brand Context import claim lost authority before commit'
      )
    }

    return receipt
  })
}

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
        capabilityKey: 'task:product-marketer.brand-context.v1',
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
