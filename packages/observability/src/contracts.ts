import { z } from 'zod'

export const POSTHOG_EU_HOST = 'https://eu.i.posthog.com'
export const POSTHOG_EU_OTLP_LOGS_URL = 'https://eu.i.posthog.com/i/v1/logs'

export const phase0ServiceSchema = z.enum([
  'web',
  'app',
  'agent-cmo',
  'agent-product-marketer',
  'agent-content',
  'agent-distribution',
  'agent-seo-discovery',
  'agent-lifecycle',
  'agent-growth',
])

export const phase0AgentKeySchema = z.enum([
  'cmo',
  'product-marketer',
  'content',
  'distribution',
  'seo-discovery',
  'lifecycle',
  'growth',
])

export const phase0OperationSchema = z.enum([
  'authentication',
  'brand_onboarding',
  'brand_context_import',
  'intent_management',
  'cmo_turn',
  'product_marketer_task',
  'task_question_resolution',
  'cron_dispatch',
  'artifact_delivery',
])

export const handledErrorCodeSchema = z.enum([
  'AUTHENTICATION_FAILED',
  'AUTHORIZATION_DENIED',
  'BAD_REQUEST',
  'CONFLICT',
  'DEPENDENCY_UNAVAILABLE',
  'IMPORT_FAILED',
  'INTERNAL_FAILURE',
  'NOT_FOUND',
  'RATE_LIMITED',
  'TASK_FAILED',
])

const identifierSchema = z.string().trim().min(1).max(256)
const correlationIdSchema = z.uuid()
const durationSchema = z.number().int().nonnegative().max(86_400_000)
const countSchema = z.number().int().positive().max(100_000)

export const phase0ProductEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      brandId: z.uuid(),
      kind: z.literal('brand_created'),
      organizationId: identifierSchema,
      subjectId: identifierSchema,
    })
    .strict(),
  z
    .object({
      brandId: z.uuid(),
      intentId: z.uuid(),
      intentRevision: z.number().int().positive().max(2_147_483_647),
      kind: z.literal('intent_declared'),
      subjectId: identifierSchema,
    })
    .strict(),
  z
    .object({
      artifactCount: countSchema,
      brandId: z.uuid(),
      durationMs: durationSchema,
      kind: z.literal('brand_context_import_completed'),
      subjectId: identifierSchema,
    })
    .strict(),
])

export const handledErrorSchema = z
  .object({
    brandId: z.uuid().optional(),
    code: handledErrorCodeSchema,
    correlationId: correlationIdSchema,
    kind: z.literal('handled_error'),
    operation: phase0OperationSchema,
    retryable: z.boolean(),
    subjectId: identifierSchema.optional(),
    surface: z.enum(['client', 'server']),
    taskId: z.uuid().optional(),
  })
  .strict()

export const operationalLogSchema = z.discriminatedUnion('kind', [
  z
    .object({
      agentKey: phase0AgentKeySchema.optional(),
      brandId: z.uuid().optional(),
      correlationId: correlationIdSchema,
      durationMs: durationSchema,
      kind: z.literal('operation_result'),
      operation: phase0OperationSchema,
      outcome: z.enum(['completed', 'partial', 'blocked', 'failed']),
      taskId: z.uuid().optional(),
    })
    .strict(),
  handledErrorSchema,
])

const runtimeEnvironmentSchema = z
  .object({
    nodeEnv: z.string().optional(),
    vercelEnv: z.string().optional(),
  })
  .strict()

const projectTokenSchema = z.string().regex(/^phc_[A-Za-z0-9_-]{8,252}$/)

const runtimeConfigSchema = z
  .object({
    environment: runtimeEnvironmentSchema,
    service: phase0ServiceSchema,
    token: z.string().optional(),
  })
  .strict()

const productionConfigSchema = z
  .object({
    environment: z
      .object({
        nodeEnv: z.literal('production'),
        vercelEnv: z.literal('production'),
      })
      .strict(),
    service: phase0ServiceSchema,
    token: projectTokenSchema,
  })
  .strict()

export type Phase0Service = z.infer<typeof phase0ServiceSchema>
export type Phase0AgentKey = z.infer<typeof phase0AgentKeySchema>
export type Phase0Operation = z.infer<typeof phase0OperationSchema>
export type HandledErrorCode = z.infer<typeof handledErrorCodeSchema>
export type Phase0ProductEvent = z.infer<typeof phase0ProductEventSchema>
export type HandledError = z.infer<typeof handledErrorSchema>
export type OperationalLog = z.infer<typeof operationalLogSchema>
export type ObservabilityRuntimeConfig = z.infer<typeof runtimeConfigSchema>
export type ProductionTelemetryConfig = z.infer<typeof productionConfigSchema>

export const parseProductionTelemetryConfig = (
  input: unknown
): ProductionTelemetryConfig | null => {
  const parsed = productionConfigSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
