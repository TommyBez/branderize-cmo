import { randomUUID } from 'node:crypto'

import type { Database } from '@repo/db/client'
import { actions, brands, creditLedger, intents } from '@repo/db/schema/domain'
import { evaluatePolicy } from '@repo/policy'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { operationKey, requestHash } from './canonical'
import type { TrustedOrganizationAccess } from './context'
import { fail } from './errors'
import {
  ensureHumanActor,
  requireCurrentOrganizationMember,
  requireMutationRole,
} from './internal'
import { readOrganizationActionReceipt } from './receipts'
import { reconcileBrandSchedules } from './schedules'

const ALPHA_GRANT_AMOUNT = '5.000000'
const TRAILING_SLASH_PATTERN = /\/$/u

const nonBlankSchema = z.string().trim().min(1)
const websiteUrlSchema = z.url().transform((value) => {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The website URL must use HTTP or HTTPS')
  }
  url.hash = ''
  if (url.pathname === '/') {
    url.pathname = ''
  }
  return url.href.replace(TRAILING_SLASH_PATTERN, '')
})

export const createBrandOnboardingInputSchema = z
  .object({
    brandName: nonBlankSchema.max(160),
    brandSlug: nonBlankSchema.max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    intentStatement: nonBlankSchema.max(2000),
    requestId: nonBlankSchema.max(500),
    websiteUrl: websiteUrlSchema,
  })
  .strict()

const onboardingReceiptSchema = z
  .object({
    actionId: z.uuid(),
    brandId: z.uuid(),
    intentId: z.uuid(),
    intentRevision: z.literal(1),
    outcome: z.literal('brand_created'),
  })
  .strict()

export type CreateBrandOnboardingInput = z.input<
  typeof createBrandOnboardingInputSchema
>
export type BrandOnboardingReceipt = z.infer<typeof onboardingReceiptSchema>

export const createBrandOnboarding = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedOrganizationAccess
  readonly database: Database
  readonly input: CreateBrandOnboardingInput
}): Promise<BrandOnboardingReceipt> => {
  const parsed = createBrandOnboardingInputSchema.parse(input)
  const receiptOperationKey = operationKey('brand-onboarding', parsed.requestId)
  const semanticHash = requestHash({
    brandName: parsed.brandName,
    brandSlug: parsed.brandSlug,
    intentStatement: parsed.intentStatement,
    organizationId: access.organizationId,
    userId: access.userId,
    websiteUrl: parsed.websiteUrl,
  })

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentOrganizationMember(
      transaction,
      access
    )
    const replay = await readOrganizationActionReceipt({
      operationKey: receiptOperationKey,
      organizationId: access.organizationId,
      receiptSchema: onboardingReceiptSchema,
      requestHash: semanticHash,
      resourceKey: `brand-slug:${parsed.brandSlug}`,
      transaction,
    })
    if (replay !== null) {
      return replay
    }

    const [existingBrand] = await transaction
      .select({ id: brands.id })
      .from(brands)
      .where(
        and(
          eq(brands.organizationId, access.organizationId),
          eq(brands.slug, parsed.brandSlug)
        )
      )
      .limit(1)

    if (existingBrand !== undefined) {
      fail(
        'operation_conflict',
        'This organization already contains a brand with that slug'
      )
    }

    requireMutationRole(currentMember.role)

    const humanActor = await ensureHumanActor(transaction, access.userId)

    const policy = evaluatePolicy({
      actor: { actorKey: humanActor.actorKey, kind: 'human' },
      authorization: {
        humanActorKey: humanActor.actorKey,
        kind: 'member',
        membership: { kind: 'current', role: currentMember.role },
        mode: 'direct-mutation',
      },
      capability: { kind: 'not-required' },
      currentBrandRestrictions: [],
      effect: { phase: 'graph-internal' },
      origin: { kind: 'brand-administration' },
    })
    if (policy.verdict !== 'allowed') {
      fail('access_denied', `Policy denied onboarding: ${policy.reason}`)
    }

    const [brand] = await transaction
      .insert(brands)
      .values({
        name: parsed.brandName,
        onboardingStatus: 'incomplete',
        organizationId: access.organizationId,
        slug: parsed.brandSlug,
        websiteUrl: parsed.websiteUrl,
      })
      .returning({ id: brands.id })
    if (brand === undefined) {
      return fail(
        'invalid_operation',
        'Brand creation returned no canonical row'
      )
    }

    await reconcileBrandSchedules({ brandId: brand.id, transaction })

    const intentId = randomUUID()
    await transaction.insert(intents).values({
      authorActorId: humanActor.id,
      brandId: brand.id,
      id: intentId,
      parentIntentId: null,
      revision: 1,
      statement: parsed.intentStatement,
      status: 'active',
    })

    const actionId = randomUUID()
    const receipt: BrandOnboardingReceipt = {
      actionId,
      brandId: brand.id,
      intentId,
      intentRevision: 1,
      outcome: 'brand_created',
    }
    await transaction.insert(actions).values({
      actorId: humanActor.id,
      brandId: brand.id,
      effectClass: 'graph-internal',
      id: actionId,
      intentId,
      operationKey: receiptOperationKey,
      payload: receipt,
      policySnapshot: policy,
      rationale:
        'Create the first human-authored brand Intent during onboarding',
      requestHash: semanticHash,
      type: 'intent_declared',
    })
    await transaction.insert(creditLedger).values({
      amount: ALPHA_GRANT_AMOUNT,
      brandId: brand.id,
      entryType: 'grant',
      idempotencyKey: `phase0-alpha:${brand.id}`,
      metadata: { commercial: false, source: 'phase0-alpha' },
    })

    return receipt
  })
}
