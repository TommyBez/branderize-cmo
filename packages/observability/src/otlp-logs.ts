import { SeverityNumber } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import {
  defaultResource,
  resourceFromAttributes,
} from '@opentelemetry/resources'
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs'
import {
  POSTHOG_EU_OTLP_LOGS_URL,
  type ProductionTelemetryConfig,
} from './contracts'
import type { OtlpLogRecord, OtlpLogsTransport } from './core'

const severityFor = (
  level: OtlpLogRecord['level']
): { readonly number: SeverityNumber; readonly text: string } => {
  switch (level) {
    case 'info':
      return { number: SeverityNumber.INFO, text: 'INFO' }
    case 'warn':
      return { number: SeverityNumber.WARN, text: 'WARN' }
    case 'error':
      return { number: SeverityNumber.ERROR, text: 'ERROR' }
    default: {
      const unreachable: never = level
      return unreachable
    }
  }
}

export const createOtlpLogsTransport = (
  config: ProductionTelemetryConfig
): OtlpLogsTransport => {
  const exporter = new OTLPLogExporter({
    concurrencyLimit: 1,
    headers: { Authorization: `Bearer ${config.token}` },
    timeoutMillis: 3000,
    url: POSTHOG_EU_OTLP_LOGS_URL,
  })
  const processor = new BatchLogRecordProcessor({
    exporter,
    exportTimeoutMillis: 3000,
    maxExportBatchSize: 20,
    maxQueueSize: 100,
    scheduledDelayMillis: 1000,
  })
  const resource = defaultResource().merge(
    resourceFromAttributes({
      'deployment.environment.name': 'production',
      'service.name': config.service,
      'service.namespace': 'branderize',
    })
  )
  const provider = new LoggerProvider({ processors: [processor], resource })
  const logger = provider.getLogger('@repo/observability', '0.0.0')

  return {
    emit: async (record) => {
      const severity = severityFor(record.level)
      logger.emit({
        attributes: { ...record.attributes },
        body: record.body,
        eventName: record.eventName,
        severityNumber: severity.number,
        severityText: severity.text,
      })
      await provider.forceFlush()
    },
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  }
}
