import 'server-only'

import { createHmac, randomUUID } from 'node:crypto'
import type { TrustedMemberAccess } from '@repo/brain/context'
import {
  type CmoConversationProjection,
  openCmoConversation,
  readPersistedCmoEvents,
} from '@repo/brain/conversations'
import { getOpenProductMarketerQuestionTaskId } from '@repo/brain/task-projections'
import { db } from '@repo/db'
import {
  Client,
  type ClientSessionState,
  type EveMessage,
  type MessageStreamEvent,
} from 'eve/client'
import { z } from 'zod'

import { resolveAgentEndpoint } from './agent-endpoints'
import { appEnvironment } from './auth'
import {
  cmoEventsEndAtCurrentTurnBoundary,
  projectCmoMessages,
  readCompleteCmoEventPrefix,
} from './cmo-recovery'
import { AppAccessError } from './dal'
import { parseEveMessageProjectionEvent } from './eve-message-event'

const BRIDGE_LIFETIME_SECONDS = 45
const SNAPSHOT_TIMEOUT_MS = 8000

export const mintCmoBridgeToken = ({
  brandId,
  conversationId,
  sourceTaskId,
  userId,
}: {
  readonly brandId: string
  readonly conversationId: string
  readonly sourceTaskId?: string
  readonly userId: string
}): string => {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      aud: 'agent-cmo',
      brand_id: brandId,
      conversation_id: conversationId,
      exp: issuedAt + BRIDGE_LIFETIME_SECONDS,
      iat: issuedAt,
      iss: 'branderize-app',
      jti: randomUUID(),
      ...(sourceTaskId === undefined ? {} : { source_task_id: sourceTaskId }),
      sub: userId,
    })
  ).toString('base64url')
  const unsigned = `${header}.${payload}`
  const signature = createHmac('sha256', appEnvironment.CMO_BRIDGE_SECRET)
    .update(unsigned)
    .digest('base64url')
  return `${unsigned}.${signature}`
}

export const createCmoClient = ({
  brandId,
  conversationId,
  sourceTaskId,
  userId,
}: {
  readonly brandId: string
  readonly conversationId: string
  readonly sourceTaskId?: string
  readonly userId: string
}): Client =>
  new Client({
    auth: {
      bearer: () =>
        mintCmoBridgeToken({
          brandId,
          conversationId,
          ...(sourceTaskId === undefined ? {} : { sourceTaskId }),
          userId,
        }),
    },
    host: resolveAgentEndpoint({ agentKey: 'cmo' }),
    redirect: 'error',
  })

export const fetchCmoRuntime = async ({
  brandId,
  conversationId,
  init,
  path,
  userId,
}: {
  readonly brandId: string
  readonly conversationId: string
  readonly init?: RequestInit
  readonly path: string
  readonly userId: string
}): Promise<Response> => {
  const headers = new Headers(init?.headers)
  headers.set(
    'authorization',
    `Bearer ${mintCmoBridgeToken({ brandId, conversationId, userId })}`
  )
  const endpoint = resolveAgentEndpoint({ agentKey: 'cmo' })
  const relativePath = path.startsWith('/') ? path.slice(1) : path

  return await fetch(new URL(relativePath, `${endpoint}/`), {
    ...init,
    headers,
    redirect: 'error',
  })
}

export const authorizeCmoSourceTaskClaim = async ({
  access,
  sourceTaskId: sourceTaskIdInput,
}: {
  readonly access: TrustedMemberAccess
  readonly sourceTaskId: string
}): Promise<string> => {
  const sourceTaskId = z.uuid().parse(sourceTaskIdInput)
  const openTaskId = await getOpenProductMarketerQuestionTaskId({
    access,
    database: db,
    sourceTaskId,
  })
  if (openTaskId === null) {
    throw new AppAccessError(
      'not_found',
      'The source task is not an open Product Marketer question bundle'
    )
  }
  return openTaskId
}

export type CmoConsoleState =
  | {
      readonly initialEvents: readonly MessageStreamEvent[]
      readonly initialSession: ClientSessionState | undefined
      readonly kind: 'available'
      readonly recoveryRequired: boolean
    }
  | {
      readonly kind: 'read-only'
      readonly messages: readonly EveMessage[]
    }

export const readCmoAuditFallback = async ({
  access,
  conversationId,
}: {
  readonly access: TrustedMemberAccess
  readonly conversationId: string
}): Promise<readonly EveMessage[]> => {
  const persistedEvents = await readCompleteCmoEventPrefix({
    readPage: async (afterIngestionSequence) =>
      await readPersistedCmoEvents({
        access,
        database: db,
        input: {
          afterIngestionSequence,
          conversationId,
          limit: 100,
        },
      }),
  })
  const messageEvents: MessageStreamEvent[] = []
  for (const persisted of persistedEvents) {
    const event = parseEveMessageProjectionEvent(persisted.event)
    if (event !== null) {
      messageEvents.push(event)
    }
  }
  return projectCmoMessages(messageEvents)
}

export const loadCmoConsoleState = async ({
  access,
  conversation,
}: {
  readonly access: TrustedMemberAccess
  readonly conversation: CmoConversationProjection
}): Promise<CmoConsoleState> => {
  try {
    const client = createCmoClient({
      brandId: conversation.brandId,
      conversationId: conversation.id,
      userId: conversation.ownerUserId,
    })
    if (conversation.session.kind === 'unbound') {
      await client.health()
      return {
        initialEvents: [],
        initialSession: undefined,
        kind: 'available',
        recoveryRequired: false,
      }
    }

    const snapshot = await client.sessions
      .attach(conversation.session.sessionId)
      .snapshot({ signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS) })
    return {
      initialEvents: snapshot.events,
      initialSession: snapshot.session,
      kind: 'available',
      recoveryRequired: !cmoEventsEndAtCurrentTurnBoundary(snapshot.events),
    }
  } catch {
    if (conversation.session.kind === 'unbound') {
      return { kind: 'read-only', messages: [] }
    }
    try {
      return {
        kind: 'read-only',
        messages: await readCmoAuditFallback({
          access,
          conversationId: conversation.id,
        }),
      }
    } catch {
      return { kind: 'read-only', messages: [] }
    }
  }
}

export const openOwnedCmoConversation = async ({
  access,
  conversationId,
}: {
  readonly access: TrustedMemberAccess
  readonly conversationId: string
}): Promise<CmoConversationProjection> =>
  await openCmoConversation({
    access,
    database: db,
    input: { conversationId },
  })
