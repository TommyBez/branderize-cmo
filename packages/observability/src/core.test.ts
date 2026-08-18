import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  HandledError,
  ObservabilityRuntimeConfig,
  Phase0ProductEvent,
} from './contracts'
import {
  createObservability,
  type OtlpLogRecord,
  type OtlpLogsTransport,
  type PostHogSignal,
  type PostHogTransport,
} from './core'

const brandId = '11111111-1111-4111-8111-111111111111'
const correlationId = '44444444-4444-4444-8444-444444444444'
const intentId = '22222222-2222-4222-8222-222222222222'
const taskId = '33333333-3333-4333-8333-333333333333'
const subjectId = 'customer-secret@example.test'
const SUBJECT_HASH_PATTERN = /^subject_[a-f0-9]{32}$/
const BRAND_HASH_PATTERN = /^brand_[a-f0-9]{32}$/
const CORRELATION_HASH_PATTERN = /^correlation_[a-f0-9]{32}$/
const TASK_HASH_PATTERN = /^task_[a-f0-9]{32}$/

const productionConfig: ObservabilityRuntimeConfig = {
  environment: { nodeEnv: 'production', vercelEnv: 'production' },
  service: 'app',
  token: 'phc_phase0_test_token',
}

const productEvent: Phase0ProductEvent = {
  brandId,
  kind: 'brand_created',
  organizationId: 'organization-sensitive-id',
  subjectId,
}

const handledError: HandledError = {
  brandId,
  code: 'DEPENDENCY_UNAVAILABLE',
  correlationId,
  kind: 'handled_error',
  operation: 'brand_context_import',
  retryable: true,
  subjectId,
  surface: 'server',
  taskId,
}

interface RecordingTransports {
  readonly logs: OtlpLogRecord[]
  readonly otlpLogs: OtlpLogsTransport
  readonly posthog: PostHogTransport
  readonly signals: PostHogSignal[]
}

const createRecordingTransports = (): RecordingTransports => {
  const signals: PostHogSignal[] = []
  const logs: OtlpLogRecord[] = []
  return {
    logs,
    otlpLogs: {
      emit: (record) => {
        logs.push(record)
        return Promise.resolve()
      },
      flush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    },
    posthog: {
      capture: (signal) => {
        signals.push(signal)
        return Promise.resolve()
      },
      flush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    },
    signals,
  }
}

interface ProductCase {
  readonly event: Phase0ProductEvent
  readonly propertyKeys: readonly string[]
}

const productCases: readonly ProductCase[] = [
  {
    event: productEvent,
    propertyKeys: ['brand_id_hash', 'organization_id_hash', 'service_name'],
  },
  {
    event: {
      brandId,
      intentId,
      intentRevision: 1,
      kind: 'intent_declared',
      subjectId,
    },
    propertyKeys: [
      'brand_id_hash',
      'intent_id_hash',
      'intent_revision',
      'service_name',
    ],
  },
  {
    event: {
      artifactCount: 3,
      brandId,
      durationMs: 250,
      kind: 'brand_context_import_completed',
      subjectId,
    },
    propertyKeys: [
      'artifact_count',
      'brand_id_hash',
      'duration_ms',
      'service_name',
    ],
  },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Phase 0 observability', () => {
  it('maps every product event to its exact property allowlist', async () => {
    await Promise.all(
      productCases.map(async (productCase) => {
        const recordings = createRecordingTransports()
        const observability = createObservability({
          config: productionConfig,
          transports: recordings,
        })
        await observability.captureProductEvent(productCase.event)
        const [signal] = recordings.signals
        expect(signal?.kind).toBe('product_event')
        if (signal?.kind !== 'product_event') {
          throw new Error('Expected a product event signal')
        }
        expect(Object.keys(signal.properties).sort()).toEqual(
          [...productCase.propertyKeys].sort()
        )
        expect(signal.distinctId).toMatch(SUBJECT_HASH_PATTERN)
        const serialized = JSON.stringify(signal)
        expect(serialized).not.toContain(subjectId)
        expect(serialized).not.toContain(brandId)
        expect(serialized).not.toContain(intentId)
        expect(serialized).not.toContain(taskId)
      })
    )
  })

  it('rejects extra properties instead of exporting prompt or payload content', async () => {
    const recordings = createRecordingTransports()
    const observability = createObservability({
      config: productionConfig,
      transports: recordings,
    })
    const unsafeInput = {
      ...productEvent,
      prompt: 'private prompt and model output',
      requestBody: { password: 'secret' },
    }

    await Reflect.apply(observability.captureProductEvent, observability, [
      unsafeInput,
    ])

    expect(recordings.signals).toHaveLength(0)
  })

  it('creates a synthetic handled error and a closed OTLP record', async () => {
    const recordings = createRecordingTransports()
    const observability = createObservability({
      config: productionConfig,
      transports: recordings,
    })

    await observability.captureHandledError(handledError)

    const [signal] = recordings.signals
    expect(signal?.kind).toBe('handled_error')
    if (signal?.kind !== 'handled_error') {
      throw new Error('Expected a handled error signal')
    }
    expect(signal.exception.name).toBe('BranderizeHandledServerError')
    expect(signal.exception.message).toBe(
      'DEPENDENCY_UNAVAILABLE during brand_context_import'
    )
    expect(Object.keys(signal.properties).sort()).toEqual([
      'brand_id_hash',
      'correlation_id_hash',
      'error_code',
      'error_surface',
      'operation',
      'retryable',
      'service_name',
      'task_id_hash',
    ])

    const [log] = recordings.logs
    expect(log).toEqual({
      attributes: {
        'branderize.brand.id_hash': expect.stringMatching(BRAND_HASH_PATTERN),
        'branderize.correlation.id_hash': expect.stringMatching(
          CORRELATION_HASH_PATTERN
        ),
        'branderize.operation': 'brand_context_import',
        'branderize.task.id_hash': expect.stringMatching(TASK_HASH_PATTERN),
        'error.code': 'DEPENDENCY_UNAVAILABLE',
        'error.handled': true,
        'error.retryable': true,
        'error.surface': 'server',
        'error.synthetic': true,
      },
      body: 'phase0.handled_error',
      eventName: 'phase0.handled_error',
      level: 'error',
    })
    const serialized = `${JSON.stringify(signal.properties)}${JSON.stringify(log)}${signal.exception.message}${signal.exception.stack}`
    expect(serialized).not.toContain(subjectId)
    expect(serialized).not.toContain(brandId)
    expect(serialized).not.toContain(correlationId)
    expect(serialized).not.toContain(taskId)
  })

  it('rejects an original Error even when an untyped caller adds it', async () => {
    const recordings = createRecordingTransports()
    const observability = createObservability({
      config: productionConfig,
      transports: recordings,
    })
    const originalError = new Error(
      'secret token, request body, transcript, prompt, and model output'
    )
    const unsafeInput = { ...handledError, error: originalError }

    await Reflect.apply(observability.captureHandledError, observability, [
      unsafeInput,
    ])

    expect(recordings.signals).toHaveLength(0)
    expect(recordings.logs).toHaveLength(0)
  })

  it('keeps operational log bodies and attributes closed', async () => {
    const recordings = createRecordingTransports()
    const observability = createObservability({
      config: productionConfig,
      transports: recordings,
    })

    await observability.emitOperationalLog({
      agentKey: 'product-marketer',
      brandId,
      correlationId,
      durationMs: 75,
      kind: 'operation_result',
      operation: 'cron_dispatch',
      outcome: 'completed',
      taskId,
    })
    const unsafeLog = {
      correlationId,
      durationMs: 75,
      kind: 'operation_result',
      operation: 'cron_dispatch',
      outcome: 'completed',
      payload: 'private request and response content',
    }
    await Reflect.apply(observability.emitOperationalLog, observability, [
      unsafeLog,
    ])

    expect(recordings.logs).toHaveLength(1)
    const [log] = recordings.logs
    if (!log) {
      throw new Error('Expected an operational log')
    }
    expect(log.body).toBe('phase0.operation_result')
    expect(Object.keys(log.attributes).sort()).toEqual([
      'branderize.agent.key',
      'branderize.brand.id_hash',
      'branderize.correlation.id_hash',
      'branderize.duration_ms',
      'branderize.operation',
      'branderize.outcome',
      'branderize.task.id_hash',
    ])
    expect(JSON.stringify(log)).not.toContain('private')
    expect(JSON.stringify(log)).not.toContain(brandId)
    expect(JSON.stringify(log)).not.toContain(correlationId)
    expect(JSON.stringify(log)).not.toContain(taskId)
    expect(log.attributes['branderize.agent.key']).toBe('product-marketer')
  })

  it('never reaches a transport or fetch outside exact production', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }))
    const network = async (): Promise<void> => {
      await fetch('https://eu.i.posthog.com/should-not-run')
    }
    const posthog: PostHogTransport = {
      capture: network,
      flush: network,
      shutdown: network,
    }
    const otlpLogs: OtlpLogsTransport = {
      emit: network,
      flush: network,
      shutdown: network,
    }
    const nonProductionConfigs: readonly ObservabilityRuntimeConfig[] = [
      {
        environment: { nodeEnv: 'test', vercelEnv: 'production' },
        service: 'app',
        token: 'phc_phase0_test_token',
      },
      {
        environment: { nodeEnv: 'production', vercelEnv: 'preview' },
        service: 'app',
        token: 'phc_phase0_test_token',
      },
      {
        environment: { nodeEnv: 'development', vercelEnv: 'development' },
        service: 'app',
        token: 'phc_phase0_test_token',
      },
      {
        environment: { nodeEnv: 'production', vercelEnv: 'production' },
        service: 'app',
        token: 'phx_not_a_project_token',
      },
    ]

    await Promise.all(
      nonProductionConfigs.map(async (config) => {
        const observability = createObservability({
          config,
          transports: { otlpLogs, posthog },
        })
        expect(observability.enabled).toBe(false)
        await Promise.all([
          observability.captureProductEvent(productEvent),
          observability.captureHandledError(handledError),
          observability.emitOperationalLog({
            correlationId,
            durationMs: 12,
            kind: 'operation_result',
            operation: 'authentication',
            outcome: 'completed',
          }),
          observability.flush(),
          observability.shutdown(),
        ])
      })
    )

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('swallows transport failures for capture, flush, and shutdown', async () => {
    const fail = (): Promise<void> =>
      Promise.reject(new Error('transport unavailable'))
    const observability = createObservability({
      config: productionConfig,
      transports: {
        otlpLogs: { emit: fail, flush: fail, shutdown: fail },
        posthog: { capture: fail, flush: fail, shutdown: fail },
      },
    })

    expect(observability.enabled).toBe(true)
    await expect(
      observability.captureProductEvent(productEvent)
    ).resolves.toBeUndefined()
    await expect(
      observability.captureHandledError(handledError)
    ).resolves.toBeUndefined()
    await expect(
      observability.emitOperationalLog({
        correlationId,
        durationMs: 30,
        kind: 'operation_result',
        operation: 'cron_dispatch',
        outcome: 'failed',
      })
    ).resolves.toBeUndefined()
    await expect(observability.flush()).resolves.toBeUndefined()
    await expect(observability.shutdown()).resolves.toBeUndefined()
  })
})
