'use server'

import { randomUUID } from 'node:crypto'

import {
  checkpointCmoConversation,
  createCmoConversation,
} from '@repo/brain/conversations'
import { BrainError } from '@repo/brain/errors'
import { refineIntent } from '@repo/brain/intents'
import { createBrandOnboarding } from '@repo/brain/onboarding'
import { db } from '@repo/db'
import type { HandledErrorCode } from '@repo/observability/contracts'
import type { EveMessage } from 'eve/client'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { auth } from './auth'
import { authorizeCmoSourceTaskClaim, readCmoAuditFallback } from './cmo'
import {
  ContextImportUnavailableError,
  importCanonicalBrandContext,
} from './context-import'
import {
  AppAccessError,
  requireBrandRequestContext,
  requireOrganizationMembership,
  requireRequestSession,
} from './dal'
import type { FormState } from './form-state'
import {
  elapsedTelemetryMilliseconds,
  scheduleAppHandledError,
  scheduleAppOperationalLog,
  scheduleAppProductEvent,
} from './observability'
import {
  OnboardingOrganizationConflictError,
  resolveOnboardingOrganization,
} from './onboarding-organization'

const nonBlankSchema = z.string().trim().min(1)
const optionalIdentifierSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))

const httpsWebsiteSchema = z.url().superRefine((value, context) => {
  if (new URL(value).protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'Use an HTTPS website URL' })
  }
})

const onboardingFormSchema = z
  .object({
    brandName: nonBlankSchema.max(160),
    brandSlug: nonBlankSchema.max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    intentStatement: nonBlankSchema.max(2000),
    organizationId: optionalIdentifierSchema,
    organizationName: z.string().trim().max(160),
    organizationSlug: z
      .string()
      .trim()
      .max(80)
      .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/u),
    requestId: nonBlankSchema.max(500),
    websiteUrl: httpsWebsiteSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.organizationId === null &&
      (value.organizationName.length === 0 ||
        value.organizationSlug.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Organization name and slug are required',
        path: ['organizationName'],
      })
    }
  })

const refineFormSchema = z
  .object({
    acceptanceCriteria: z.string().max(12_000),
    brandId: z.uuid(),
    constraints: z.string().max(12_000),
    expectedRevision: z.coerce.number().int().positive(),
    intentId: z.uuid(),
    requestId: nonBlankSchema.max(500),
  })
  .strict()

const brandSelectorSchema = z.object({ brandId: z.uuid() }).strict()
const conversationFormSchema = z
  .object({
    brandId: z.uuid(),
    sourceTaskId: optionalIdentifierSchema,
    title: z.string().trim().max(160),
  })
  .strict()
const conversationCheckpointSchema = z
  .object({
    brandId: z.uuid(),
    conversationId: z.uuid(),
    sessionId: nonBlankSchema.max(500),
    streamIndex: z.number().int().nonnegative(),
  })
  .strict()
const conversationSelectorSchema = z
  .object({
    brandId: z.uuid(),
    conversationId: z.uuid(),
  })
  .strict()

const formValue = (
  formData: FormData,
  name: string
): FormDataEntryValue | null => formData.get(name)

const publicErrorMessage = (error: unknown): string => {
  if (error instanceof z.ZodError) {
    return 'Controlla i campi e riprova.'
  }
  if (error instanceof ContextImportUnavailableError) {
    return 'Import non configurato in questo ambiente.'
  }
  if (error instanceof OnboardingOrganizationConflictError) {
    return 'Lo slug dell’organizzazione è già in uso.'
  }
  if (error instanceof AppAccessError) {
    return error.code === 'unauthenticated'
      ? 'La sessione è scaduta. Accedi di nuovo.'
      : 'Non hai accesso a questa operazione.'
  }
  if (error instanceof BrainError) {
    switch (error.code) {
      case 'stale_intent':
        return 'L’Intent è cambiato. Ricarica la pagina prima di riprovare.'
      case 'operation_conflict':
      case 'stale_head':
        return 'Esiste già uno stato canonico più recente.'
      case 'access_denied':
        return 'Il tuo ruolo non consente questa operazione.'
      default:
        return 'L’operazione canonica non è stata completata.'
    }
  }
  return 'Servizio temporaneamente non disponibile.'
}

const linesOrNull = (value: string): string[] | null => {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.length === 0 ? null : lines
}

interface ClosedTelemetryFailure {
  readonly code: HandledErrorCode
  readonly retryable: boolean
}

const closedTelemetryFailure = (error: unknown): ClosedTelemetryFailure => {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return { code: 'BAD_REQUEST', retryable: false }
  }
  if (error instanceof ContextImportUnavailableError) {
    return { code: 'DEPENDENCY_UNAVAILABLE', retryable: false }
  }
  if (error instanceof OnboardingOrganizationConflictError) {
    return { code: 'CONFLICT', retryable: false }
  }
  if (error instanceof AppAccessError) {
    switch (error.code) {
      case 'unauthenticated':
        return { code: 'AUTHENTICATION_FAILED', retryable: true }
      case 'forbidden':
        return { code: 'AUTHORIZATION_DENIED', retryable: false }
      case 'not_found':
        return { code: 'NOT_FOUND', retryable: false }
      default:
        return { code: 'INTERNAL_FAILURE', retryable: false }
    }
  }
  if (error instanceof BrainError) {
    switch (error.code) {
      case 'access_denied':
        return { code: 'AUTHORIZATION_DENIED', retryable: false }
      case 'brand_not_found':
      case 'conversation_not_found':
      case 'intent_not_found':
      case 'task_not_found':
        return { code: 'NOT_FOUND', retryable: false }
      case 'already_claimed':
      case 'completion_conflict':
      case 'operation_conflict':
      case 'stale_head':
      case 'stale_intent':
        return { code: 'CONFLICT', retryable: true }
      default:
        return { code: 'INTERNAL_FAILURE', retryable: false }
    }
  }
  return { code: 'INTERNAL_FAILURE', retryable: true }
}

const scheduleActionFailure = ({
  correlationId,
  error,
  operation,
}: {
  readonly correlationId: string
  readonly error: unknown
  readonly operation:
    | 'brand_context_import'
    | 'brand_onboarding'
    | 'cmo_turn'
    | 'intent_management'
}): void => {
  const failure = closedTelemetryFailure(error)
  scheduleAppHandledError({
    code: failure.code,
    correlationId,
    kind: 'handled_error',
    operation,
    retryable: failure.retryable,
    surface: 'server',
  })
}

export const onboardBrandAction = async (
  _state: FormState,
  formData: FormData
): Promise<FormState> => {
  const correlationId = randomUUID()
  const startedAt = Date.now()
  let destination: string
  try {
    const session = await requireRequestSession()
    const parsed = onboardingFormSchema.parse({
      brandName: formValue(formData, 'brandName'),
      brandSlug: formValue(formData, 'brandSlug'),
      intentStatement: formValue(formData, 'intentStatement'),
      organizationId: formValue(formData, 'organizationId'),
      organizationName: formValue(formData, 'organizationName'),
      organizationSlug: formValue(formData, 'organizationSlug'),
      requestId: formValue(formData, 'requestId'),
      websiteUrl: formValue(formData, 'websiteUrl'),
    })

    let { organizationId } = parsed
    if (organizationId === null) {
      const requestHeaders = await headers()
      organizationId = await resolveOnboardingOrganization({
        createOrganization: async ({ metadata, name, slug }) =>
          await auth.api.createOrganization({
            body: { metadata, name, slug },
            headers: requestHeaders,
          }),
        database: db,
        input: {
          brandName: parsed.brandName,
          brandSlug: parsed.brandSlug,
          intentStatement: parsed.intentStatement,
          organizationName: parsed.organizationName,
          organizationSlug: parsed.organizationSlug,
          requestId: parsed.requestId,
          userId: session.user.id,
          websiteUrl: parsed.websiteUrl,
        },
      })
    } else {
      await requireOrganizationMembership({
        organizationId,
        userId: session.user.id,
      })
    }

    const receipt = await createBrandOnboarding({
      access: { organizationId, userId: session.user.id },
      database: db,
      input: {
        brandName: parsed.brandName,
        brandSlug: parsed.brandSlug,
        intentStatement: parsed.intentStatement,
        requestId: parsed.requestId,
        websiteUrl: parsed.websiteUrl,
      },
    })
    scheduleAppProductEvent({
      brandId: receipt.brandId,
      kind: 'brand_created',
      organizationId,
      subjectId: session.user.id,
    })
    scheduleAppProductEvent({
      brandId: receipt.brandId,
      intentId: receipt.intentId,
      intentRevision: receipt.intentRevision,
      kind: 'intent_declared',
      subjectId: session.user.id,
    })
    scheduleAppOperationalLog({
      brandId: receipt.brandId,
      correlationId,
      durationMs: elapsedTelemetryMilliseconds(startedAt),
      kind: 'operation_result',
      operation: 'brand_onboarding',
      outcome: 'completed',
    })
    destination = `/brands/${receipt.brandId}/context`
  } catch (error) {
    scheduleActionFailure({
      correlationId,
      error,
      operation: 'brand_onboarding',
    })
    return { kind: 'error', message: publicErrorMessage(error) }
  }

  redirect(destination)
}

export const refineIntentAction = async (
  _state: FormState,
  formData: FormData
): Promise<FormState> => {
  const correlationId = randomUUID()
  const startedAt = Date.now()
  try {
    const parsed = refineFormSchema.parse({
      acceptanceCriteria: formValue(formData, 'acceptanceCriteria'),
      brandId: formValue(formData, 'brandId'),
      constraints: formValue(formData, 'constraints'),
      expectedRevision: formValue(formData, 'expectedRevision'),
      intentId: formValue(formData, 'intentId'),
      requestId: formValue(formData, 'requestId'),
    })
    const { access } = await requireBrandRequestContext(parsed.brandId)
    await refineIntent({
      access,
      database: db,
      input: {
        acceptanceCriteria: linesOrNull(parsed.acceptanceCriteria),
        constraints: linesOrNull(parsed.constraints),
        expectedRevision: parsed.expectedRevision,
        intentId: parsed.intentId,
        requestId: parsed.requestId,
      },
    })
    scheduleAppOperationalLog({
      brandId: parsed.brandId,
      correlationId,
      durationMs: elapsedTelemetryMilliseconds(startedAt),
      kind: 'operation_result',
      operation: 'intent_management',
      outcome: 'completed',
    })
    revalidatePath(`/brands/${parsed.brandId}/intent/${parsed.intentId}`)
    revalidatePath(`/brands/${parsed.brandId}/intent`)
    return { kind: 'success', message: 'Intent aggiornato nel grafo canonico.' }
  } catch (error) {
    scheduleActionFailure({
      correlationId,
      error,
      operation: 'intent_management',
    })
    return { kind: 'error', message: publicErrorMessage(error) }
  }
}

export const retryContextImportAction = async (
  _state: FormState,
  formData: FormData
): Promise<FormState> => {
  const correlationId = randomUUID()
  const startedAt = Date.now()
  try {
    const { brandId } = brandSelectorSchema.parse({
      brandId: formValue(formData, 'brandId'),
    })
    const { access } = await requireBrandRequestContext(brandId)
    const receipt = await importCanonicalBrandContext({ access })
    const durationMs = elapsedTelemetryMilliseconds(startedAt)
    scheduleAppProductEvent({
      artifactCount: receipt.artifactObjectIds.length,
      brandId,
      durationMs,
      kind: 'brand_context_import_completed',
      subjectId: access.userId,
    })
    scheduleAppOperationalLog({
      brandId,
      correlationId,
      durationMs,
      kind: 'operation_result',
      operation: 'brand_context_import',
      outcome: 'completed',
    })
    revalidatePath(`/brands/${brandId}/context`)
    revalidatePath(`/brands/${brandId}/objects/${receipt.brandContextObjectId}`)
    return {
      kind: 'success',
      message: 'Brand Context importato con provenienza canonica.',
    }
  } catch (error) {
    scheduleActionFailure({
      correlationId,
      error,
      operation: 'brand_context_import',
    })
    return { kind: 'error', message: publicErrorMessage(error) }
  }
}

export const createConversationAction = async (
  _state: FormState,
  formData: FormData
): Promise<FormState> => {
  const correlationId = randomUUID()
  let destination: string
  try {
    const parsed = conversationFormSchema.parse({
      brandId: formValue(formData, 'brandId'),
      sourceTaskId: formValue(formData, 'sourceTaskId'),
      title: formValue(formData, 'title'),
    })
    const { access } = await requireBrandRequestContext(parsed.brandId)
    if (parsed.sourceTaskId !== null) {
      await authorizeCmoSourceTaskClaim({
        access,
        sourceTaskId: parsed.sourceTaskId,
      })
    }
    const conversation = await createCmoConversation({
      access,
      database: db,
      input: { title: parsed.title.length === 0 ? null : parsed.title },
    })
    const sourceTaskSearch =
      parsed.sourceTaskId === null
        ? ''
        : `?sourceTaskId=${encodeURIComponent(parsed.sourceTaskId)}`
    destination = `/brands/${parsed.brandId}/cmo/${conversation.id}${sourceTaskSearch}`
  } catch (error) {
    scheduleActionFailure({ correlationId, error, operation: 'cmo_turn' })
    return { kind: 'error', message: publicErrorMessage(error) }
  }

  redirect(destination)
}

export const checkpointCmoConversationAction = async (input: {
  readonly brandId: string
  readonly conversationId: string
  readonly sessionId: string
  readonly streamIndex: number
}): Promise<void> => {
  const correlationId = randomUUID()
  try {
    const parsed = conversationCheckpointSchema.parse(input)
    const { access } = await requireBrandRequestContext(parsed.brandId)
    await checkpointCmoConversation({
      access,
      database: db,
      input: {
        conversationId: parsed.conversationId,
        sessionId: parsed.sessionId,
        streamIndex: parsed.streamIndex,
      },
    })
  } catch (error) {
    scheduleActionFailure({ correlationId, error, operation: 'cmo_turn' })
    throw new Error('Unable to checkpoint the CMO conversation', {
      cause: error,
    })
  }
}

export const readCmoAuditFallbackAction = async (input: {
  readonly brandId: string
  readonly conversationId: string
}): Promise<readonly EveMessage[]> => {
  const correlationId = randomUUID()
  try {
    const parsed = conversationSelectorSchema.parse(input)
    const { access } = await requireBrandRequestContext(parsed.brandId)
    return await readCmoAuditFallback({
      access,
      conversationId: parsed.conversationId,
    })
  } catch (error) {
    scheduleActionFailure({ correlationId, error, operation: 'cmo_turn' })
    throw new Error('Unable to read the persisted CMO transcript', {
      cause: error,
    })
  }
}

export const switchBrandAction = async (formData: FormData): Promise<void> => {
  const { brandId } = brandSelectorSchema.parse({
    brandId: formValue(formData, 'brandId'),
  })
  await requireBrandRequestContext(brandId)
  redirect(`/brands/${brandId}/intent`)
}
