import { createHash } from 'node:crypto'
import {
  type HandledError,
  handledErrorSchema,
  type ObservabilityRuntimeConfig,
  type OperationalLog,
  operationalLogSchema,
  type Phase0ProductEvent,
  type Phase0Service,
  parseProductionTelemetryConfig,
  phase0ProductEventSchema,
} from './contracts'

export type SafeTelemetryProperty = string | number | boolean

export type PostHogSignal =
  | {
      readonly distinctId: string
      readonly event: Phase0ProductEvent['kind']
      readonly kind: 'product_event'
      readonly properties: Readonly<Record<string, SafeTelemetryProperty>>
    }
  | {
      readonly distinctId: string
      readonly exception: Error
      readonly kind: 'handled_error'
      readonly properties: Readonly<Record<string, SafeTelemetryProperty>>
    }

export interface OtlpLogRecord {
  readonly attributes: Readonly<Record<string, SafeTelemetryProperty>>
  readonly body: 'phase0.operation_result' | 'phase0.handled_error'
  readonly eventName: 'phase0.operation_result' | 'phase0.handled_error'
  readonly level: 'info' | 'warn' | 'error'
}

export interface PostHogTransport {
  capture: (signal: PostHogSignal) => Promise<void>
  flush: () => Promise<void>
  shutdown: () => Promise<void>
}

export interface OtlpLogsTransport {
  emit: (record: OtlpLogRecord) => Promise<void>
  flush: () => Promise<void>
  shutdown: () => Promise<void>
}

export interface ObservabilityTransports {
  readonly otlpLogs?: OtlpLogsTransport
  readonly posthog?: PostHogTransport
}

export interface CreateObservabilityOptions {
  readonly config: ObservabilityRuntimeConfig
  readonly transports?: ObservabilityTransports
}

export interface Observability {
  captureHandledError: (input: HandledError) => Promise<void>
  captureProductEvent: (input: Phase0ProductEvent) => Promise<void>
  emitOperationalLog: (input: OperationalLog) => Promise<void>
  readonly enabled: boolean
  flush: () => Promise<void>
  shutdown: () => Promise<void>
}

type IdentifierKind =
  | 'brand'
  | 'correlation'
  | 'intent'
  | 'organization'
  | 'subject'
  | 'task'

const hashIdentifier = (kind: IdentifierKind, value: string): string => {
  const digest = createHash('sha256')
    .update(`branderize:phase0:${kind}:${value}`)
    .digest('hex')
    .slice(0, 32)
  return `${kind}_${digest}`
}

class SyntheticHandledError extends Error {
  constructor(input: HandledError) {
    super(`${input.code} during ${input.operation}`)
    this.name =
      input.surface === 'client'
        ? 'BranderizeHandledClientError'
        : 'BranderizeHandledServerError'
    Error.captureStackTrace?.(this, SyntheticHandledError)
  }
}

const productSignalFor = (
  service: Phase0Service,
  event: Phase0ProductEvent
): PostHogSignal => {
  const distinctId = hashIdentifier('subject', event.subjectId)

  switch (event.kind) {
    case 'brand_created':
      return {
        distinctId,
        event: event.kind,
        kind: 'product_event',
        properties: {
          brand_id_hash: hashIdentifier('brand', event.brandId),
          organization_id_hash: hashIdentifier(
            'organization',
            event.organizationId
          ),
          service_name: service,
        },
      }
    case 'intent_declared':
      return {
        distinctId,
        event: event.kind,
        kind: 'product_event',
        properties: {
          brand_id_hash: hashIdentifier('brand', event.brandId),
          intent_id_hash: hashIdentifier('intent', event.intentId),
          intent_revision: event.intentRevision,
          service_name: service,
        },
      }
    case 'brand_context_import_completed':
      return {
        distinctId,
        event: event.kind,
        kind: 'product_event',
        properties: {
          artifact_count: event.artifactCount,
          brand_id_hash: hashIdentifier('brand', event.brandId),
          duration_ms: event.durationMs,
          service_name: service,
        },
      }
    default: {
      const unreachable: never = event
      return unreachable
    }
  }
}

const handledErrorSignalFor = (
  service: Phase0Service,
  input: HandledError
): PostHogSignal => ({
  distinctId: input.subjectId
    ? hashIdentifier('subject', input.subjectId)
    : `service:${service}`,
  exception: new SyntheticHandledError(input),
  kind: 'handled_error',
  properties: {
    ...(input.brandId
      ? { brand_id_hash: hashIdentifier('brand', input.brandId) }
      : {}),
    correlation_id_hash: hashIdentifier('correlation', input.correlationId),
    error_code: input.code,
    error_surface: input.surface,
    operation: input.operation,
    retryable: input.retryable,
    service_name: service,
    ...(input.taskId
      ? { task_id_hash: hashIdentifier('task', input.taskId) }
      : {}),
  },
})

const logRecordFor = (input: OperationalLog): OtlpLogRecord => {
  switch (input.kind) {
    case 'operation_result':
      return {
        attributes: {
          ...(input.agentKey ? { 'branderize.agent.key': input.agentKey } : {}),
          ...(input.brandId
            ? {
                'branderize.brand.id_hash': hashIdentifier(
                  'brand',
                  input.brandId
                ),
              }
            : {}),
          'branderize.correlation.id_hash': hashIdentifier(
            'correlation',
            input.correlationId
          ),
          'branderize.duration_ms': input.durationMs,
          'branderize.operation': input.operation,
          'branderize.outcome': input.outcome,
          ...(input.taskId
            ? {
                'branderize.task.id_hash': hashIdentifier('task', input.taskId),
              }
            : {}),
        },
        body: 'phase0.operation_result',
        eventName: 'phase0.operation_result',
        level: input.outcome === 'failed' ? 'error' : 'info',
      }
    case 'handled_error':
      return {
        attributes: {
          ...(input.brandId
            ? {
                'branderize.brand.id_hash': hashIdentifier(
                  'brand',
                  input.brandId
                ),
              }
            : {}),
          'branderize.correlation.id_hash': hashIdentifier(
            'correlation',
            input.correlationId
          ),
          'branderize.operation': input.operation,
          ...(input.taskId
            ? {
                'branderize.task.id_hash': hashIdentifier('task', input.taskId),
              }
            : {}),
          'error.code': input.code,
          'error.handled': true,
          'error.retryable': input.retryable,
          'error.surface': input.surface,
          'error.synthetic': true,
        },
        body: 'phase0.handled_error',
        eventName: 'phase0.handled_error',
        level: 'error',
      }
    default: {
      const unreachable: never = input
      return unreachable
    }
  }
}

const failOpen = async (operation: () => Promise<void>): Promise<void> => {
  try {
    await operation()
  } catch {
    // Telemetry cannot change the product operation's result.
  }
}

export const createObservability = (
  options: CreateObservabilityOptions
): Observability => {
  const productionConfig = parseProductionTelemetryConfig(options.config)
  const enabled = productionConfig !== null
  const posthog = options.transports?.posthog
  const otlpLogs = options.transports?.otlpLogs

  return {
    captureHandledError: async (input) => {
      if (!(enabled && productionConfig)) {
        return
      }
      const parsed = handledErrorSchema.safeParse(input)
      if (!parsed.success) {
        return
      }
      const operations: Promise<void>[] = []
      if (posthog) {
        operations.push(
          failOpen(() =>
            posthog.capture(
              handledErrorSignalFor(productionConfig.service, parsed.data)
            )
          )
        )
      }
      if (otlpLogs) {
        operations.push(
          failOpen(() => otlpLogs.emit(logRecordFor(parsed.data)))
        )
      }
      await Promise.all(operations)
    },
    captureProductEvent: async (input) => {
      if (!(enabled && productionConfig && posthog)) {
        return
      }
      const parsed = phase0ProductEventSchema.safeParse(input)
      if (!parsed.success) {
        return
      }
      await failOpen(() =>
        posthog.capture(productSignalFor(productionConfig.service, parsed.data))
      )
    },
    emitOperationalLog: async (input) => {
      if (!(enabled && otlpLogs)) {
        return
      }
      const parsed = operationalLogSchema.safeParse(input)
      if (!parsed.success) {
        return
      }
      await failOpen(() => otlpLogs.emit(logRecordFor(parsed.data)))
    },
    enabled,
    flush: async () => {
      const operations: Promise<void>[] = []
      if (enabled && posthog) {
        operations.push(failOpen(() => posthog.flush()))
      }
      if (enabled && otlpLogs) {
        operations.push(failOpen(() => otlpLogs.flush()))
      }
      await Promise.all(operations)
    },
    shutdown: async () => {
      const operations: Promise<void>[] = []
      if (enabled && posthog) {
        operations.push(failOpen(() => posthog.shutdown()))
      }
      if (enabled && otlpLogs) {
        operations.push(failOpen(() => otlpLogs.shutdown()))
      }
      await Promise.all(operations)
    },
  }
}
