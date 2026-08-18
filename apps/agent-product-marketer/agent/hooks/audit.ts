import { reportSessionEventIngestionFailure } from '@repo/agents/runtime-alert'
import {
  ingestSessionEvent,
  parsePersistableSessionEvent,
} from '@repo/brain/session-events'
import { bindTaskSession } from '@repo/brain/tasks'
import { defineHook } from 'eve/hooks'

import {
  productMarketerSessionLineageFromContext,
  readProductMarketerSessionIdentity,
  taskExecutionFromContext,
} from '../lib/task-runtime'

export default defineHook({
  events: {
    async '*'(event, context) {
      const identity = readProductMarketerSessionIdentity(context)
      const { db } = await import('@repo/db')
      const session = productMarketerSessionLineageFromContext(context)
      if (session.kind === 'root' && event.type === 'session.started') {
        await bindTaskSession({
          database: db,
          execution: taskExecutionFromContext(context),
        })
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
              kind: 'task',
              startedAt: identity.startedAt,
              taskId: identity.taskId,
            },
            session,
          },
        })
      } catch {
        try {
          reportSessionEventIngestionFailure('agent-product-marketer')
        } catch {
          // Runtime alerting is fail-open by contract.
        }
      }
    },
  },
})
