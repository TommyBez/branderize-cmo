import { reportSessionEventIngestionFailure } from '@repo/agents/runtime-alert'
import { defineHook } from 'eve/hooks'

import {
  readTaskSession,
  taskExecutionOf,
  taskSessionLineageFromContext,
} from './task-session'

export const defineTaskAuditHook = () =>
  defineHook({
    events: {
      async '*'(event, context) {
        const identity = readTaskSession(context)
        const { db } = await import('@repo/db')
        const session = taskSessionLineageFromContext(context)
        if (session.kind === 'root' && event.type === 'session.started') {
          const { bindTaskSession } = await import('@repo/brain/tasks')
          await bindTaskSession({
            database: db,
            execution: taskExecutionOf(context),
          })
        }
        try {
          const { ingestSessionEvent, parsePersistableSessionEvent } =
            await import('@repo/brain/session-events')
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
            reportSessionEventIngestionFailure(`agent-${identity.workerKey}`)
          } catch {
            // Runtime alerting is fail-open by contract.
          }
        }
      },
    },
  })
