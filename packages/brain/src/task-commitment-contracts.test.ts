import type { Database } from '@repo/db/client'
import { describe, expect, it } from 'vitest'

import type { TrustedCmoTurnAccess } from './context'
import type { BrainError } from './errors'
import { requestSpecialistWorkInputSchema } from './task-contracts'
import { requestSpecialistWork } from './task-request'

const intentId = '018f47a6-72d3-7a93-b49a-d91f50dd1771'
const reportObjectId = '018f47a6-72d3-7a93-b49a-d91f50dd1999'

const dummyAccess = {
  brandId: intentId,
  callId: 'call-1',
  cmoActorId: '00000000-0000-0000-0000-000000000101',
  cmoActorKey: 'agent:cmo',
  conversationId: intentId,
  humanActorId: intentId,
  humanActorKey: 'human:user-1',
  organizationId: 'organization:1',
  role: 'owner',
  rootSessionId: 'session-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  userId: 'user-1',
} as const satisfies TrustedCmoTurnAccess

describe('human commitment specialist request', () => {
  it('fails closed before a database write for content.notion-page.v1', async () => {
    const input = requestSpecialistWorkInputSchema.parse({
      intentId,
      kind: 'content.notion-page.v1',
      payload: { reportObjectId, title: 'Launch brief' },
      requestId: 'human-kind-rejected',
    })
    await expect(
      requestSpecialistWork({
        access: dummyAccess,
        database: {} as Database,
        input,
      })
    ).rejects.toMatchObject({
      code: 'invalid_task',
    } satisfies Partial<BrainError>)
  })
})
