'use server'

import 'server-only'

import {
  connectBrandConnection,
  disconnectBrandConnection,
} from '@repo/brain/connections'
import { BrainError } from '@repo/brain/errors'
import { providerSlotSchema } from '@repo/connections/connect'
import { db } from '@repo/db'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { AppAccessError, requireBrandRequestContext } from './dal'
import type { FormState } from './form-state'

const SCOPE_SEPARATOR = /[\n,]/u
const nonBlankSchema = z.string().trim().min(1)
const optionalInstallationSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))

const connectFormSchema = z
  .object({
    accountLabel: nonBlankSchema.max(240),
    brandId: z.uuid(),
    connectorUid: nonBlankSchema.max(512),
    installationId: optionalInstallationSchema.pipe(
      nonBlankSchema.max(512).nullable()
    ),
    providerSlot: providerSlotSchema,
    requestId: nonBlankSchema.max(500),
    scopes: z.string().max(4000),
  })
  .strict()

const disconnectFormSchema = z
  .object({
    brandId: z.uuid(),
    providerSlot: providerSlotSchema,
    requestId: nonBlankSchema.max(500),
  })
  .strict()

const formValue = (
  formData: FormData,
  name: string
): FormDataEntryValue | null => formData.get(name)

const scopeList = (value: string): string[] =>
  value
    .split(SCOPE_SEPARATOR)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0)

const publicErrorMessage = (error: unknown): string => {
  if (error instanceof z.ZodError) {
    return 'Check the fields and try again.'
  }
  if (error instanceof AppAccessError) {
    return error.code === 'unauthenticated'
      ? 'Your session expired. Sign in again.'
      : 'You do not have access to this operation.'
  }
  if (error instanceof BrainError) {
    switch (error.code) {
      case 'operation_conflict':
        return 'That connection slot is already active.'
      case 'access_denied':
        return 'Your role cannot perform this operation.'
      default:
        return 'The operation could not be completed.'
    }
  }
  return 'The service is temporarily unavailable.'
}

export const connectBrandConnectionAction = async (
  _state: FormState,
  formData: FormData
): Promise<FormState> => {
  try {
    const parsed = connectFormSchema.parse({
      accountLabel: formValue(formData, 'accountLabel'),
      brandId: formValue(formData, 'brandId'),
      connectorUid: formValue(formData, 'connectorUid'),
      installationId: formValue(formData, 'installationId') ?? '',
      providerSlot: formValue(formData, 'providerSlot'),
      requestId: formValue(formData, 'requestId'),
      scopes: formValue(formData, 'scopes') ?? '',
    })
    const { access } = await requireBrandRequestContext(parsed.brandId)
    await connectBrandConnection({
      access,
      database: db,
      input: {
        accountLabel: parsed.accountLabel,
        connectorUid: parsed.connectorUid,
        installationId: parsed.installationId,
        providerSlot: parsed.providerSlot,
        requestId: parsed.requestId,
        scopes: scopeList(parsed.scopes),
      },
    })
    revalidatePath(`/brands/${parsed.brandId}`)
    return { kind: 'success', message: 'Connection recorded.' }
  } catch (error) {
    return { kind: 'error', message: publicErrorMessage(error) }
  }
}

export const disconnectBrandConnectionAction = async (
  _state: FormState,
  formData: FormData
): Promise<FormState> => {
  try {
    const parsed = disconnectFormSchema.parse({
      brandId: formValue(formData, 'brandId'),
      providerSlot: formValue(formData, 'providerSlot'),
      requestId: formValue(formData, 'requestId'),
    })
    const { access } = await requireBrandRequestContext(parsed.brandId)
    await disconnectBrandConnection({
      access,
      database: db,
      input: {
        providerSlot: parsed.providerSlot,
        requestId: parsed.requestId,
      },
    })
    revalidatePath(`/brands/${parsed.brandId}`)
    return { kind: 'success', message: 'Connection disconnected.' }
  } catch (error) {
    return { kind: 'error', message: publicErrorMessage(error) }
  }
}
