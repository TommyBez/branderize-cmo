import { reportSessionEventIngestionFailure } from '@repo/agents/runtime-alert'
import { bindCmoSession } from '@repo/brain/conversations'
import {
  ingestSessionEvent,
  parsePersistableSessionEvent,
} from '@repo/brain/session-events'
import { defineHook } from 'eve/hooks'

import {
  readCmoSessionIdentity,
  resolveTrustedCmoSessionMemberAccess,
} from './runtime-access'

export const createCmoAuditHook = () =>
  defineHook({
    events: {
      async '*'(event, context) {
        const identity = readCmoSessionIdentity(context)
        const { db } = await import('@repo/db')
        const { parent } = context.session
        if (parent === undefined && event.type === 'session.started') {
          const access = await resolveTrustedCmoSessionMemberAccess({
            allowUnboundSession: true,
            context,
            database: db,
          })
          await bindCmoSession({
            access,
            database: db,
            input: {
              conversationId: identity.conversationId,
              parentSessionId: null,
              sessionId: context.session.id,
              source: 'root-hook',
            },
          })
        }
        const session =
          parent === undefined
            ? {
                kind: 'root' as const,
                sessionId: context.session.id,
              }
            : {
                kind: 'child' as const,
                parentCallId: parent.callId,
                parentSessionId: parent.sessionId,
                rootSessionId: parent.rootSessionId,
                sessionId: context.session.id,
              }
        try {
          const parsedEvent = parsePersistableSessionEvent(event)
          await ingestSessionEvent({
            database: db,
            input: {
              auth: {
                currentBrandId: identity.brandId,
                initiatingBrandId: identity.brandId,
              },
              event: parsedEvent,
              owner: {
                conversationId: identity.conversationId,
                kind: 'conversation',
              },
              session,
            },
          })
        } catch {
          try {
            reportSessionEventIngestionFailure('agent-cmo')
          } catch {
            // Runtime alerting is fail-open by contract.
          }
        }
      },
    },
  })

export const cmoAuditHook = createCmoAuditHook()
