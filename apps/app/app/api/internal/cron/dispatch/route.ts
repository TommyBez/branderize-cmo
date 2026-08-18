import { randomUUID, timingSafeEqual } from 'node:crypto'

import { postAgentDispatchPoke } from '@repo/agents/dispatch-poke'

import { resolveFleetEndpoints } from '@/lib/agent-endpoints'
import { appEnvironment } from '@/lib/auth'
import {
  elapsedTelemetryMilliseconds,
  scheduleAppHandledError,
  scheduleAppOperationalLog,
} from '@/lib/observability'

const matchesBearer = (header: string | null, secret: string): boolean => {
  const prefix = 'Bearer '
  if (header === null || !header.startsWith(prefix)) {
    return false
  }
  const presented = Buffer.from(header.slice(prefix.length))
  const expected = Buffer.from(secret)
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  )
}

export const GET = async (request: Request): Promise<Response> => {
  const correlationId = randomUUID()
  const startedAt = Date.now()
  let endpoints: ReturnType<typeof resolveFleetEndpoints> = []
  const url = new URL(request.url)
  if (url.search.length > 0) {
    return new Response(null, { status: 400 })
  }
  if (
    !matchesBearer(
      request.headers.get('authorization'),
      appEnvironment.CRON_SECRET
    )
  ) {
    return new Response(null, { status: 401 })
  }

  try {
    endpoints = resolveFleetEndpoints()
    const results = await Promise.allSettled(
      endpoints.map(async ({ agentKey, endpoint }) => {
        const rootStartedAt = Date.now()
        try {
          const result = await postAgentDispatchPoke({
            endpoint,
            secret: appEnvironment.DISPATCH_SECRET,
          })
          if (result.outcome !== 'accepted') {
            throw new Error(`Agent dispatch poke deferred: ${result.reason}`)
          }
          scheduleAppOperationalLog({
            agentKey,
            correlationId,
            durationMs: elapsedTelemetryMilliseconds(rootStartedAt),
            kind: 'operation_result',
            operation: 'cron_dispatch',
            outcome: 'completed',
          })
        } catch (error) {
          scheduleAppOperationalLog({
            agentKey,
            correlationId,
            durationMs: elapsedTelemetryMilliseconds(rootStartedAt),
            kind: 'operation_result',
            operation: 'cron_dispatch',
            outcome: 'failed',
          })
          throw error
        }
      })
    )
    const accepted = results.filter(
      (result) => result.status === 'fulfilled'
    ).length
    if (accepted !== endpoints.length) {
      scheduleAppOperationalLog({
        correlationId,
        durationMs: elapsedTelemetryMilliseconds(startedAt),
        kind: 'operation_result',
        operation: 'cron_dispatch',
        outcome: 'partial',
      })
      return Response.json(
        { accepted, attempted: endpoints.length, status: 'partial' },
        { status: 503 }
      )
    }
    scheduleAppOperationalLog({
      correlationId,
      durationMs: elapsedTelemetryMilliseconds(startedAt),
      kind: 'operation_result',
      operation: 'cron_dispatch',
      outcome: 'completed',
    })
    return Response.json({
      accepted,
      attempted: endpoints.length,
      status: 'ok',
    })
  } catch {
    scheduleAppHandledError({
      code: 'DEPENDENCY_UNAVAILABLE',
      correlationId,
      kind: 'handled_error',
      operation: 'cron_dispatch',
      retryable: true,
      surface: 'server',
    })
    return Response.json(
      { accepted: 0, attempted: endpoints.length, status: 'unavailable' },
      { status: 503 }
    )
  }
}
