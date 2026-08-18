import type { Database } from '@repo/db/client'
import { cmoConversations, sessionEvents } from '@repo/db/schema/domain'
import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { MemberRole, TrustedMemberAccess } from './context'
import { fail } from './errors'
import {
  type BrainTransaction,
  requireCurrentBrandMember,
  requireMutationRole,
} from './internal'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100
const MAX_TITLE_LENGTH = 160
const MAX_RUNTIME_IDENTIFIER_LENGTH = 2048

const identifierSchema = z.string().trim().min(1)
const runtimeIdentifierSchema = identifierSchema.max(
  MAX_RUNTIME_IDENTIFIER_LENGTH
)

export const createCmoConversationInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(MAX_TITLE_LENGTH)
      .nullable()
      .default(null),
  })
  .strict()

const conversationSelectorSchema = z
  .object({ conversationId: z.uuid() })
  .strict()

const conversationListCursorSchema = z
  .object({
    createdAt: z.date(),
    id: z.uuid(),
  })
  .strict()

export const listCmoConversationsInputSchema = z
  .object({
    cursor: conversationListCursorSchema.nullable().default(null),
    includeArchived: z.boolean().default(false),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
  })
  .strict()

export const bindCmoSessionInputSchema = z.discriminatedUnion('source', [
  z
    .object({
      conversationId: z.uuid(),
      parentSessionId: z.null(),
      sessionId: runtimeIdentifierSchema,
      source: z.literal('root-hook'),
    })
    .strict(),
  z
    .object({
      conversationId: z.uuid(),
      sessionId: runtimeIdentifierSchema,
      source: z.literal('proxy-create-response'),
    })
    .strict(),
])

export const checkpointCmoConversationInputSchema = z
  .object({
    conversationId: z.uuid(),
    sessionId: runtimeIdentifierSchema,
    streamIndex: z.number().int().nonnegative(),
  })
  .strict()

const readOperationNameSchema = z.enum([
  'metadata',
  'reconnect',
  'snapshot',
  'stream',
  'transcript',
])

const writeOperationNameSchema = z.enum([
  'clear',
  'compact',
  'input-responses',
  'message',
  'reset',
])

export const cmoSessionOperationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('read'),
      name: readOperationNameSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('write'),
      name: writeOperationNameSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('cancel'),
      turnId: runtimeIdentifierSchema,
    })
    .strict(),
])

export const authorizeCmoSessionInputSchema = z
  .object({
    conversationId: z.uuid(),
    operation: cmoSessionOperationSchema,
    sessionId: runtimeIdentifierSchema,
  })
  .strict()

export const readPersistedCmoEventsInputSchema = z
  .object({
    afterIngestionSequence: z
      .number()
      .int()
      .positive()
      .nullable()
      .default(null),
    conversationId: z.uuid(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
  })
  .strict()

export type CreateCmoConversationInput = z.input<
  typeof createCmoConversationInputSchema
>
export type ListCmoConversationsInput = z.input<
  typeof listCmoConversationsInputSchema
>
export type BindCmoSessionInput = z.input<typeof bindCmoSessionInputSchema>
export type CheckpointCmoConversationInput = z.input<
  typeof checkpointCmoConversationInputSchema
>
export type CmoSessionOperation = z.infer<typeof cmoSessionOperationSchema>
export type AuthorizeCmoSessionInput = z.input<
  typeof authorizeCmoSessionInputSchema
>
export type ReadPersistedCmoEventsInput = z.input<
  typeof readPersistedCmoEventsInputSchema
>

export type CmoConversationSession =
  | {
      readonly kind: 'unbound'
      readonly streamIndex: 0
    }
  | {
      readonly kind: 'bound'
      readonly sessionId: string
      readonly streamIndex: number
    }

export interface CmoConversationProjection {
  readonly archivedAt: Date | null
  readonly brandId: string
  readonly createdAt: Date
  readonly id: string
  readonly ownerUserId: string
  readonly session: CmoConversationSession
  readonly title: string | null
  readonly updatedAt: Date
}

export interface CmoConversationListPage {
  readonly items: readonly CmoConversationProjection[]
  readonly nextCursor: {
    readonly createdAt: Date
    readonly id: string
  } | null
}

export type CmoSessionOperationAuthorization =
  | {
      readonly kind: 'read'
      readonly name: z.infer<typeof readOperationNameSchema>
    }
  | {
      readonly kind: 'write'
      readonly name: z.infer<typeof writeOperationNameSchema>
    }
  | {
      readonly kind: 'cancel'
      readonly scope: 'exact-observed-turn' | 'writer'
      readonly turnId: string
    }

export interface AuthorizedCmoSession {
  readonly authorization: CmoSessionOperationAuthorization
  readonly brandId: string
  readonly conversationId: string
  readonly ownerUserId: string
  readonly sessionId: string
  readonly streamIndex: number
}

export interface PersistedCmoEvent {
  readonly event: unknown
  readonly eventKind: string
  readonly ingestionSequence: number
  readonly metaId: string
  readonly occurredAt: Date | null
  readonly sessionId: string
}

export interface PersistedCmoEventPage {
  readonly events: readonly PersistedCmoEvent[]
  readonly nextAfterIngestionSequence: number | null
}

interface CmoOperationAuthorizationInput {
  readonly operation: CmoSessionOperation
  readonly role: MemberRole
}

type ConversationRow = typeof cmoConversations.$inferSelect

const conversationProjection = (
  row: ConversationRow
): CmoConversationProjection => {
  if (row.sessionId === null) {
    if (row.streamIndex !== 0) {
      return fail(
        'invalid_operation',
        'An unbound CMO conversation cannot have a persisted stream cursor'
      )
    }
    return {
      archivedAt: row.archivedAt,
      brandId: row.brandId,
      createdAt: row.createdAt,
      id: row.id,
      ownerUserId: row.ownerUserId,
      session: { kind: 'unbound', streamIndex: 0 },
      title: row.title,
      updatedAt: row.updatedAt,
    }
  }

  return {
    archivedAt: row.archivedAt,
    brandId: row.brandId,
    createdAt: row.createdAt,
    id: row.id,
    ownerUserId: row.ownerUserId,
    session: {
      kind: 'bound',
      sessionId: row.sessionId,
      streamIndex: row.streamIndex,
    },
    title: row.title,
    updatedAt: row.updatedAt,
  }
}

const requireOwnedConversation = async ({
  access,
  conversationId,
  transaction,
}: {
  readonly access: TrustedMemberAccess
  readonly conversationId: string
  readonly transaction: BrainTransaction
}): Promise<ConversationRow> => {
  const [conversation] = await transaction
    .select()
    .from(cmoConversations)
    .where(
      and(
        eq(cmoConversations.id, conversationId),
        eq(cmoConversations.brandId, access.brandId),
        eq(cmoConversations.ownerUserId, access.userId)
      )
    )
    .limit(1)

  if (conversation === undefined) {
    return fail(
      'conversation_not_found',
      'The CMO conversation is not available to the current owner'
    )
  }
  return conversation
}

const requireOwnedConversationForUpdate = async ({
  access,
  conversationId,
  transaction,
}: {
  readonly access: TrustedMemberAccess
  readonly conversationId: string
  readonly transaction: BrainTransaction
}): Promise<ConversationRow> => {
  const [conversation] = await transaction
    .select()
    .from(cmoConversations)
    .where(
      and(
        eq(cmoConversations.id, conversationId),
        eq(cmoConversations.brandId, access.brandId),
        eq(cmoConversations.ownerUserId, access.userId)
      )
    )
    .for('update')
    .limit(1)

  if (conversation === undefined) {
    return fail(
      'conversation_not_found',
      'The CMO conversation is not available to the current owner'
    )
  }
  return conversation
}

export const authorizeCmoOperationForRole = (
  input: CmoOperationAuthorizationInput
): CmoSessionOperationAuthorization => {
  const { operation, role } = input
  if (operation.kind === 'read') {
    return { kind: 'read', name: operation.name }
  }

  if (operation.kind === 'write') {
    requireMutationRole(role)
    return { kind: 'write', name: operation.name }
  }

  if (role !== 'viewer') {
    return { kind: 'cancel', scope: 'writer', turnId: operation.turnId }
  }

  return {
    kind: 'cancel',
    scope: 'exact-observed-turn',
    turnId: operation.turnId,
  }
}

export const createCmoConversation = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: CreateCmoConversationInput
}): Promise<CmoConversationProjection> => {
  const parsed = createCmoConversationInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    requireMutationRole(currentMember.role)

    const [conversation] = await transaction
      .insert(cmoConversations)
      .values({
        brandId: access.brandId,
        ownerUserId: access.userId,
        title: parsed.title,
      })
      .returning()

    if (conversation === undefined) {
      return fail(
        'invalid_operation',
        'CMO conversation creation returned no row'
      )
    }
    return conversationProjection(conversation)
  })
}

export const listCmoConversations = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: ListCmoConversationsInput
}): Promise<CmoConversationListPage> => {
  const parsed = listCmoConversationsInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)

    const cursorCondition =
      parsed.cursor === null
        ? undefined
        : or(
            lt(cmoConversations.createdAt, parsed.cursor.createdAt),
            and(
              eq(cmoConversations.createdAt, parsed.cursor.createdAt),
              lt(cmoConversations.id, parsed.cursor.id)
            )
          )
    const archivedCondition = parsed.includeArchived
      ? undefined
      : isNull(cmoConversations.archivedAt)
    const rows = await transaction
      .select()
      .from(cmoConversations)
      .where(
        and(
          eq(cmoConversations.brandId, access.brandId),
          eq(cmoConversations.ownerUserId, access.userId),
          archivedCondition,
          cursorCondition
        )
      )
      .orderBy(desc(cmoConversations.createdAt), desc(cmoConversations.id))
      .limit(parsed.limit + 1)

    const pageRows = rows.slice(0, parsed.limit)
    const items = pageRows.map((row) => conversationProjection(row))
    const lastItem = items.at(-1)
    const nextCursor =
      rows.length > parsed.limit && lastItem !== undefined
        ? { createdAt: lastItem.createdAt, id: lastItem.id }
        : null

    return { items, nextCursor }
  })
}

export const openCmoConversation = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: z.input<typeof conversationSelectorSchema>
}): Promise<CmoConversationProjection> => {
  const parsed = conversationSelectorSchema.parse(input)

  return await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const conversation = await requireOwnedConversation({
      access,
      conversationId: parsed.conversationId,
      transaction,
    })
    return conversationProjection(conversation)
  })
}

export const authorizeCmoSessionCreation = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: z.input<typeof conversationSelectorSchema>
}): Promise<{
  readonly brandId: string
  readonly conversationId: string
  readonly ownerUserId: string
}> => {
  const parsed = conversationSelectorSchema.parse(input)

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    requireMutationRole(currentMember.role)
    const conversation = await requireOwnedConversation({
      access,
      conversationId: parsed.conversationId,
      transaction,
    })
    if (conversation.sessionId !== null) {
      return fail(
        'completion_conflict',
        'The CMO conversation already has an authoritative session'
      )
    }

    return {
      brandId: conversation.brandId,
      conversationId: conversation.id,
      ownerUserId: conversation.ownerUserId,
    }
  })
}

export const bindCmoSession = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: BindCmoSessionInput
}): Promise<{
  readonly conversation: CmoConversationProjection
  readonly outcome: 'bound' | 'matched'
}> => {
  const parsed = bindCmoSessionInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    requireMutationRole(currentMember.role)
    const conversation = await requireOwnedConversationForUpdate({
      access,
      conversationId: parsed.conversationId,
      transaction,
    })

    if (conversation.sessionId === parsed.sessionId) {
      return {
        conversation: conversationProjection(conversation),
        outcome: 'matched',
      }
    }
    if (conversation.sessionId !== null) {
      return fail(
        'completion_conflict',
        'The CMO conversation is bound to a different session'
      )
    }

    const [bound] = await transaction
      .update(cmoConversations)
      .set({ sessionId: parsed.sessionId })
      .where(
        and(
          eq(cmoConversations.id, conversation.id),
          eq(cmoConversations.brandId, access.brandId),
          eq(cmoConversations.ownerUserId, access.userId),
          isNull(cmoConversations.sessionId)
        )
      )
      .returning()
    if (bound === undefined) {
      return fail(
        'completion_conflict',
        'The CMO conversation session binding changed concurrently'
      )
    }

    return { conversation: conversationProjection(bound), outcome: 'bound' }
  })
}

export const authorizeCmoSession = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: AuthorizeCmoSessionInput
}): Promise<AuthorizedCmoSession> => {
  const parsed = authorizeCmoSessionInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    const conversation = await requireOwnedConversation({
      access,
      conversationId: parsed.conversationId,
      transaction,
    })
    if (conversation.sessionId !== parsed.sessionId) {
      return fail(
        'conversation_not_found',
        'The CMO session is not bound to the current owner conversation'
      )
    }

    const authorization = authorizeCmoOperationForRole({
      operation: parsed.operation,
      role: currentMember.role,
    })

    return {
      authorization,
      brandId: conversation.brandId,
      conversationId: conversation.id,
      ownerUserId: conversation.ownerUserId,
      sessionId: parsed.sessionId,
      streamIndex: conversation.streamIndex,
    }
  })
}

export const checkpointCmoConversation = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: CheckpointCmoConversationInput
}): Promise<CmoConversationProjection> => {
  const parsed = checkpointCmoConversationInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    requireMutationRole(currentMember.role)
    const conversation = await requireOwnedConversationForUpdate({
      access,
      conversationId: parsed.conversationId,
      transaction,
    })
    if (conversation.sessionId !== parsed.sessionId) {
      return fail(
        'conversation_not_found',
        'The cursor does not target the authoritative CMO session'
      )
    }

    const [checkpointed] = await transaction
      .update(cmoConversations)
      .set({
        streamIndex: sql<number>`greatest(${cmoConversations.streamIndex}, ${parsed.streamIndex})`,
      })
      .where(
        and(
          eq(cmoConversations.id, conversation.id),
          eq(cmoConversations.brandId, access.brandId),
          eq(cmoConversations.ownerUserId, access.userId),
          eq(cmoConversations.sessionId, parsed.sessionId)
        )
      )
      .returning()
    if (checkpointed === undefined) {
      return fail(
        'conversation_not_found',
        'The CMO conversation changed before cursor checkpointing'
      )
    }
    return conversationProjection(checkpointed)
  })
}

export const readPersistedCmoEvents = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: ReadPersistedCmoEventsInput
}): Promise<PersistedCmoEventPage> => {
  const parsed = readPersistedCmoEventsInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const conversation = await requireOwnedConversation({
      access,
      conversationId: parsed.conversationId,
      transaction,
    })
    if (conversation.sessionId === null) {
      return fail(
        'conversation_not_found',
        'The CMO conversation has no authoritative session transcript'
      )
    }

    const cursorCondition =
      parsed.afterIngestionSequence === null
        ? undefined
        : gt(sessionEvents.ingestionSequence, parsed.afterIngestionSequence)
    const rows = await transaction
      .select({
        event: sessionEvents.event,
        eventKind: sessionEvents.eventKind,
        ingestionSequence: sessionEvents.ingestionSequence,
        metaId: sessionEvents.metaId,
        occurredAt: sessionEvents.occurredAt,
        sessionId: sessionEvents.sessionId,
      })
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.brandId, access.brandId),
          eq(sessionEvents.conversationId, conversation.id),
          eq(sessionEvents.sessionId, conversation.sessionId),
          cursorCondition
        )
      )
      .orderBy(asc(sessionEvents.ingestionSequence))
      .limit(parsed.limit + 1)

    const events = rows.slice(0, parsed.limit)
    const lastEvent = events.at(-1)
    const nextAfterIngestionSequence =
      rows.length > parsed.limit && lastEvent !== undefined
        ? lastEvent.ingestionSequence
        : null

    return { events, nextAfterIngestionSequence }
  })
}
