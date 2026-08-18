import 'server-only'

import type { Observability } from '@repo/observability'
import type {
  HandledError,
  OperationalLog,
  Phase0ProductEvent,
} from '@repo/observability/contracts'
import { createNodeObservability } from '@repo/observability/node'
import { after } from 'next/server'

import { resolveProductionPostHogToken } from './posthog-config'

let observabilityPromise: Promise<Observability> | undefined

const observability = (): Promise<Observability> => {
  if (!observabilityPromise) {
    observabilityPromise = createNodeObservability({
      environment: {
        nodeEnv: process.env.NODE_ENV,
        vercelEnv: process.env.VERCEL_ENV,
      },
      service: 'app',
      token: resolveProductionPostHogToken(process.env) ?? undefined,
    })
  }
  return observabilityPromise
}

const schedule = (
  operation: (client: Observability) => Promise<void>
): void => {
  try {
    after(async () => {
      try {
        await operation(await observability())
      } catch {
        // Telemetry cannot change the product operation's result.
      }
    })
  } catch {
    // Missing request context also disables telemetry without changing the result.
  }
}

export const elapsedTelemetryMilliseconds = (startedAt: number): number =>
  Math.min(86_400_000, Math.max(0, Math.trunc(Date.now() - startedAt)))

export const scheduleAppProductEvent = (event: Phase0ProductEvent): void => {
  schedule(async (client) => {
    await client.captureProductEvent(event)
  })
}

export const scheduleAppHandledError = (event: HandledError): void => {
  schedule(async (client) => {
    await client.captureHandledError(event)
  })
}

export const scheduleAppOperationalLog = (event: OperationalLog): void => {
  schedule(async (client) => {
    await client.emitOperationalLog(event)
  })
}
