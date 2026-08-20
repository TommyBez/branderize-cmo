import type { AgentKey } from './registry'

export type RuntimeAlertService = `agent-${AgentKey}`

interface RuntimeAlertDependencies {
  readonly createCorrelationId: () => string
  readonly write: (record: string) => unknown
}

const defaultDependencies: RuntimeAlertDependencies = {
  createCorrelationId: () => globalThis.crypto.randomUUID(),
  write: (record) => {
    console.error(record)
  },
}

export const reportSessionEventIngestionFailure = (
  service: RuntimeAlertService,
  dependencies: RuntimeAlertDependencies = defaultDependencies
): void => {
  try {
    const alert = {
      code: 'SESSION_EVENT_INGESTION_FAILED',
      correlationId: dependencies.createCorrelationId(),
      kind: 'runtime_alert',
      service,
    } as const

    dependencies.write(`${JSON.stringify(alert)}\n`)
  } catch {
    // Alerting must never change the agent runtime outcome.
  }
}
