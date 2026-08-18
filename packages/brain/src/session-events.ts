// biome-ignore lint/performance/noBarrelFile: This explicit compatibility facade preserves the package's public API.
export {
  type AppliedCharge,
  type ModelChargeCandidate,
  type ModelChargeDecision,
  planWinningModelCharges,
  type SkippedModelCharge,
} from './session-events/charges'
export {
  derivePersistedSessionLineage,
  isAuthoritativeRootChargeBoundary,
  isAuthoritativeRootCompletion,
  isAuthoritativeRootTerminal,
  type PersistedEventProjectionRow,
  type PersistedSessionLineage,
  parsePersistableSessionEvent,
  type SessionEventEnvelope,
  type SessionEventIngestion,
  sessionEventEnvelopeSchema,
  sessionEventIngestionSchema,
} from './session-events/contracts'
export {
  type IngestSessionEventResult,
  ingestSessionEvent,
} from './session-events/ingest'
export type { TaskSettlement } from './session-events/task-settlement'
