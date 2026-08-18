import { cmoConversations, tasks } from '@repo/db/schema/domain'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { fail } from '../errors'
import type { BrainTransaction } from '../internal'

const nonBlankIdentifierSchema = z.string().trim().min(1).max(500)
const eventMetaSchema = z
  .object({
    at: z.iso.datetime({ offset: true }),
    id: nonBlankIdentifierSchema,
  })
  .catchall(z.json())

export const sessionEventEnvelopeSchema = z
  .object({
    meta: eventMetaSchema,
    type: nonBlankIdentifierSchema,
  })
  .catchall(z.json())

const rootSessionSchema = z
  .object({
    kind: z.literal('root'),
    sessionId: nonBlankIdentifierSchema,
  })
  .strict()

const childSessionSchema = z
  .object({
    kind: z.literal('child'),
    parentCallId: nonBlankIdentifierSchema,
    parentSessionId: nonBlankIdentifierSchema,
    rootSessionId: nonBlankIdentifierSchema,
    sessionId: nonBlankIdentifierSchema,
  })
  .strict()
  .superRefine((session, context) => {
    if (session.sessionId === session.parentSessionId) {
      context.addIssue({
        code: 'custom',
        message: 'A child session cannot be its own immediate parent',
        path: ['parentSessionId'],
      })
    }
    if (session.sessionId === session.rootSessionId) {
      context.addIssue({
        code: 'custom',
        message: 'A child session cannot be its own root',
        path: ['rootSessionId'],
      })
    }
  })

export const sessionOwnerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      conversationId: z.uuid(),
      kind: z.literal('conversation'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('task'),
      startedAt: z.date(),
      taskId: z.uuid(),
    })
    .strict(),
])

export const sessionEventIngestionSchema = z
  .object({
    auth: z
      .object({
        currentBrandId: z.uuid(),
        initiatingBrandId: z.uuid(),
      })
      .strict(),
    event: sessionEventEnvelopeSchema,
    owner: sessionOwnerSchema,
    session: z.discriminatedUnion('kind', [
      rootSessionSchema,
      childSessionSchema,
    ]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.auth.currentBrandId !== input.auth.initiatingBrandId) {
      context.addIssue({
        code: 'custom',
        message: 'Current and initiating session brands must match',
        path: ['auth', 'currentBrandId'],
      })
    }
  })

export type SessionEventEnvelope = z.infer<typeof sessionEventEnvelopeSchema>
export type SessionEventIngestion = z.input<typeof sessionEventIngestionSchema>
export type SessionOwner = z.infer<typeof sessionOwnerSchema>
export type SessionLineageInput = z.infer<
  typeof sessionEventIngestionSchema
>['session']

export const parsePersistableSessionEvent = (
  value: unknown
): SessionEventEnvelope => {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('A session event must have a JSON object envelope')
  }
  const normalized: unknown = JSON.parse(serialized)
  return sessionEventEnvelopeSchema.parse(normalized)
}

export interface PersistedEventProjectionRow {
  readonly conversationId: string | null
  readonly event: unknown
  readonly eventKind: string
  readonly ingestionSequence: number
  readonly metaId: string
  readonly sessionId: string
  readonly taskId: string | null
}

export interface PersistedSessionLineage {
  readonly parentCallId: string | null
  readonly parentSessionId: string | null
  readonly rootSessionId: string
  readonly sessionId: string
}

export const derivePersistedSessionLineage = (
  session: SessionLineageInput
): PersistedSessionLineage => {
  if (session.kind === 'root') {
    return {
      parentCallId: null,
      parentSessionId: null,
      rootSessionId: session.sessionId,
      sessionId: session.sessionId,
    }
  }
  return {
    parentCallId: session.parentCallId,
    parentSessionId: session.parentSessionId,
    rootSessionId: session.rootSessionId,
    sessionId: session.sessionId,
  }
}

export const validateOwnerBinding = async ({
  brandId,
  lineage,
  owner,
  transaction,
}: {
  readonly brandId: string
  readonly lineage: PersistedSessionLineage
  readonly owner: SessionOwner
  readonly transaction: BrainTransaction
}): Promise<void> => {
  if (owner.kind === 'task') {
    const [task] = await transaction
      .select({
        executionMode: tasks.executionMode,
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.id, owner.taskId), eq(tasks.brandId, brandId)))
      .for('share')
      .limit(1)
    if (
      task === undefined ||
      task.executionMode !== 'agent' ||
      task.startedAt === null ||
      task.startedAt.getTime() !== owner.startedAt.getTime()
    ) {
      return fail('invalid_event', 'Session event task binding is invalid')
    }
    if (task.sessionId !== null && task.sessionId !== lineage.rootSessionId) {
      return fail(
        'invalid_event',
        'Session event root does not match the task binding'
      )
    }
    return
  }

  const [conversation] = await transaction
    .select({ sessionId: cmoConversations.sessionId })
    .from(cmoConversations)
    .where(
      and(
        eq(cmoConversations.id, owner.conversationId),
        eq(cmoConversations.brandId, brandId)
      )
    )
    .for('share')
    .limit(1)
  if (conversation === undefined) {
    return fail(
      'invalid_event',
      'Session event conversation binding is invalid'
    )
  }
  if (
    conversation.sessionId !== null &&
    conversation.sessionId !== lineage.rootSessionId
  ) {
    return fail(
      'invalid_event',
      'Session event root does not match the conversation binding'
    )
  }
}

export interface PersistedOwnerColumns {
  readonly conversationId: string | null
  readonly taskId: string | null
}

export const ownerColumns = (owner: SessionOwner): PersistedOwnerColumns => {
  if (owner.kind === 'task') {
    return { conversationId: null, taskId: owner.taskId }
  }
  return { conversationId: owner.conversationId, taskId: null }
}

interface AuthoritativeEventContext {
  readonly event: SessionEventEnvelope
  readonly session: SessionLineageInput
}

export const isAuthoritativeRootCompletion = ({
  event,
  session,
}: AuthoritativeEventContext): boolean =>
  session.kind === 'root' && event.type === 'session.completed'

export const isAuthoritativeRootChargeBoundary = ({
  event,
  session,
}: AuthoritativeEventContext): boolean =>
  session.kind === 'root' &&
  (event.type === 'session.completed' ||
    event.type === 'session.failed' ||
    event.type === 'session.waiting' ||
    event.type === 'turn.cancelled' ||
    event.type === 'turn.failed')

export const isAuthoritativeRootTerminal = ({
  event,
  session,
}: AuthoritativeEventContext): boolean =>
  session.kind === 'root' &&
  (event.type === 'session.completed' ||
    event.type === 'session.failed' ||
    event.type === 'turn.cancelled' ||
    event.type === 'turn.failed')
