import {
  type ObservabilityRuntimeConfig,
  type Phase0Service,
  type ProductionTelemetryConfig,
  parseProductionTelemetryConfig,
} from './contracts'
import {
  createObservability,
  type Observability,
  type OtlpLogsTransport,
  type PostHogTransport,
} from './core'

export interface CreateNodeObservabilityOptions {
  readonly environment?: {
    readonly nodeEnv?: string
    readonly vercelEnv?: string
  }
  readonly service: Phase0Service
  readonly token?: string
}

const loadPostHogTransport = async (
  config: ProductionTelemetryConfig
): Promise<PostHogTransport | undefined> => {
  try {
    const module = await import('./posthog-node')
    return module.createPostHogNodeTransport(config)
  } catch {
    // A missing analytics SDK disables only the analytics transport.
  }
}

const loadOtlpLogsTransport = async (
  config: ProductionTelemetryConfig
): Promise<OtlpLogsTransport | undefined> => {
  try {
    const module = await import('./otlp-logs')
    return module.createOtlpLogsTransport(config)
  } catch {
    // A missing logs SDK disables only the logs transport.
  }
}

export const createNodeObservability = async (
  options: CreateNodeObservabilityOptions
): Promise<Observability> => {
  const config: ObservabilityRuntimeConfig = {
    environment: options.environment ?? {
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
    },
    service: options.service,
    token: options.token,
  }
  const productionConfig = parseProductionTelemetryConfig(config)
  if (!productionConfig) {
    return createObservability({ config })
  }

  const [posthog, otlpLogs] = await Promise.all([
    loadPostHogTransport(productionConfig),
    loadOtlpLogsTransport(productionConfig),
  ])

  return createObservability({
    config,
    transports: { otlpLogs, posthog },
  })
}
