import { randomUUID } from 'node:crypto'

import type { Database } from '@repo/db/client'
import { member } from '@repo/db/schema/auth'
import { actions, actors, brands, objects } from '@repo/db/schema/domain'
import { evaluatePolicy } from '@repo/policy'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { canonicalize, operationKey, requestHash } from './canonical'
import { memberRoleSchema, type TrustedMemberAccess } from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  requireMutationRole,
  requireTrustedHumanActor,
} from './internal'
import {
  BRAND_CONTEXT_SINGLETON_KEY,
  CONTEXT_DEV_ACTOR_KEY,
} from './object-contracts'
import { readActionReceipt } from './receipts'

export const CONTEXT_BOOTSTRAP_NORMALIZATION = 'context-dev-url-v1'
export const CONTEXT_BOOTSTRAP_CLAIM_STALE_AFTER_MS = 180_000

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const TRAILING_SLASH_PATTERN = /\/$/u
const nonBlankSchema = z.string().trim().min(1)
const ARTIFACT_CONTENT_TYPES = [
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'video/mp4',
] as const
const artifactExtensions = {
  'application/pdf': 'pdf',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
} satisfies Record<(typeof ARTIFACT_CONTENT_TYPES)[number], string>

const artifactContentTypeSchema = z.enum(ARTIFACT_CONTENT_TYPES)
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

const contextBootstrapReceiptSchema = z
  .object({
    actionId: z.uuid(),
    artifactObjectIds: z.array(z.uuid()),
    brandContextObjectId: z.uuid(),
    outcome: z.literal('context_bootstrapped'),
  })
  .strict()

export interface TrustedContextBootstrap {
  readonly brandId: string
  readonly systemActorId: string
  readonly systemActorKey: typeof CONTEXT_DEV_ACTOR_KEY
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
