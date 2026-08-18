import { type EventMessage, PostHog } from 'posthog-node'
import { POSTHOG_EU_HOST, type ProductionTelemetryConfig } from './contracts'
import type {
  PostHogSignal,
  PostHogTransport,
  SafeTelemetryProperty,
} from './core'

const HASHED_IDENTIFIER_PATTERN =
  /^(brand|correlation|intent|organization|subject|task)_[a-f0-9]{32}$/
const SERVICE_DISTINCT_ID_PATTERN =
  /^service:(web|app|agent-cmo|agent-product-marketer|agent-content|agent-distribution|agent-seo-discovery|agent-lifecycle|agent-growth)$/

const productPropertyKeys = (event: string): readonly string[] | null => {
  switch (event) {
    case 'brand_created':
      return ['brand_id_hash', 'organization_id_hash', 'service_name']
    case 'intent_declared':
      return [
        'brand_id_hash',
        'intent_id_hash',
        'intent_revision',
        'service_name',
      ]
    case 'brand_context_import_completed':
      return ['artifact_count', 'brand_id_hash', 'duration_ms', 'service_name']
    default:
      return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sanitizeScalarProperties = (
  input: unknown,
  keys: readonly string[]
): Record<string, SafeTelemetryProperty> | null => {
  if (!isRecord(input)) {
    return null
  }

  const properties: Record<string, SafeTelemetryProperty> = {}
  for (const key of keys) {
    const value = input[key]
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      return null
    }
    properties[key] = value
  }
  return properties
}

const isSafeDistinctId = (value: unknown): value is string =>
  typeof value === 'string' &&
  (HASHED_IDENTIFIER_PATTERN.test(value) ||
    SERVICE_DISTINCT_ID_PATTERN.test(value))

const sanitizeProductEvent = (
  event: EventMessage,
  keys: readonly string[]
): EventMessage | null => {
  if (!isSafeDistinctId(event.distinctId)) {
    return null
  }
  const properties = sanitizeScalarProperties(event.properties, keys)
  if (!properties) {
    return null
  }
  return {
    disableGeoip: true,
    distinctId: event.distinctId,
    event: event.event,
    properties,
    timestamp: event.timestamp,
    uuid: event.uuid,
  }
}

const sanitizeHandledError = (event: EventMessage): EventMessage | null => {
  if (!isSafeDistinctId(event.distinctId)) {
    return null
  }
  const properties = sanitizeScalarProperties(event.properties, [
    'correlation_id_hash',
    'error_code',
    'error_surface',
    'operation',
    'retryable',
    'service_name',
  ])
  if (!properties) {
    return null
  }
  const source = isRecord(event.properties) ? event.properties : null
  const brandIdHash = source?.brand_id_hash
  const taskIdHash = source?.task_id_hash
  if (
    brandIdHash !== undefined &&
    (typeof brandIdHash !== 'string' ||
      !HASHED_IDENTIFIER_PATTERN.test(brandIdHash))
  ) {
    return null
  }
  if (
    taskIdHash !== undefined &&
    (typeof taskIdHash !== 'string' ||
      !HASHED_IDENTIFIER_PATTERN.test(taskIdHash))
  ) {
    return null
  }
  const {
    correlation_id_hash: correlationIdHash,
    error_code: errorCode,
    error_surface: errorSurface,
    operation,
    service_name: serviceName,
  } = properties
  if (
    typeof correlationIdHash !== 'string' ||
    !HASHED_IDENTIFIER_PATTERN.test(correlationIdHash) ||
    typeof errorCode !== 'string' ||
    typeof errorSurface !== 'string' ||
    typeof operation !== 'string' ||
    typeof serviceName !== 'string'
  ) {
    return null
  }
  const errorType =
    errorSurface === 'client'
      ? 'BranderizeHandledClientError'
      : 'BranderizeHandledServerError'

  return {
    disableGeoip: true,
    distinctId: event.distinctId,
    event: '$exception',
    properties: {
      $exception_fingerprint: `${serviceName}:${errorSurface}:${operation}:${errorCode}`,
      $exception_level: 'error',
      $exception_list: [
        {
          mechanism: { handled: true, synthetic: true },
          type: errorType,
          value: `${errorCode} during ${operation}`,
        },
      ],
      ...(typeof brandIdHash === 'string'
        ? { brand_id_hash: brandIdHash }
        : {}),
      ...properties,
      ...(typeof taskIdHash === 'string' ? { task_id_hash: taskIdHash } : {}),
    },
    timestamp: event.timestamp,
    uuid: event.uuid,
  }
}

export const sanitizePostHogEvent = (
  event: EventMessage | null
): EventMessage | null => {
  if (!event) {
    return null
  }
  if (event.event === '$exception') {
    return sanitizeHandledError(event)
  }
  const keys = productPropertyKeys(event.event)
  return keys ? sanitizeProductEvent(event, keys) : null
}

const captureSignal = async (
  client: PostHog,
  signal: PostHogSignal
): Promise<void> => {
  switch (signal.kind) {
    case 'product_event':
      await client.captureImmediate({
        disableGeoip: true,
        distinctId: signal.distinctId,
        event: signal.event,
        properties: { ...signal.properties },
      })
      return
    case 'handled_error':
      await client.captureExceptionImmediate(
        signal.exception,
        signal.distinctId,
        { ...signal.properties }
      )
      return
    default: {
      const unreachable: never = signal
      return unreachable
    }
  }
}

export const createPostHogNodeTransport = (
  config: ProductionTelemetryConfig
): PostHogTransport => {
  const client = new PostHog(config.token, {
    before_send: sanitizePostHogEvent,
    disableGeoip: true,
    enableExceptionAutocapture: false,
    enableLocalEvaluation: false,
    flushAt: 1,
    flushInterval: 10_000,
    host: POSTHOG_EU_HOST,
    maxBatchSize: 20,
    maxQueueSize: 100,
    personProfiles: 'never',
    requestTimeout: 3000,
  })

  return {
    capture: (signal) => captureSignal(client, signal),
    flush: () => client.flush(),
    shutdown: () => client.shutdown(),
  }
}
