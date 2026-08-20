import type { AgentModelOptionsDefinition } from 'eve'
import { z } from 'zod'

import type { TaskIntentSnapshot } from './task-snapshot'
import {
  buildProductMarketerTaskPrompt,
  hasOpenProductMarketerQuestions,
  PRODUCT_MARKETER_TASK_KIND,
  PRODUCT_MARKETER_WORKER_KEY,
  type ProductMarketerClaimContext,
  type ProductMarketerCompletion,
  type ProductMarketerPayload,
  type ProductMarketerResult,
  productMarketerClaimContextSchema,
  productMarketerCompletionSchema,
  productMarketerPayloadSchema,
  productMarketerResultSchema,
  requiredProductMarketerOutputIds,
} from './tasks'

export const AGENT_KEYS = [
  'cmo',
  'product-marketer',
  'content',
  'distribution',
  'seo-discovery',
  'lifecycle',
  'growth',
] as const

export type AgentKey = (typeof AGENT_KEYS)[number]
export type AgentLane = 'cmo' | 'consultation' | 'task'
export type DeploymentEnvironment =
  | 'development'
  | 'preview'
  | 'production'
  | 'test'

export interface ModelProfile {
  readonly contextWindowTokens: number
  readonly key: string
  readonly model: string
  readonly modelOptions?: AgentModelOptionsDefinition
}

export interface RegisteredTaskCompletion {
  readonly outputObjectIds: readonly string[]
  readonly result: unknown
  readonly status: 'blocked' | 'completed' | 'partial'
}

export interface RegisteredOpenQuestionProjection {
  readonly questions: readonly string[]
  readonly reason: string
  readonly status: 'blocked' | 'partial'
  readonly summary: string
}

export interface RegisteredTaskQuestionPolicy {
  readonly hasOpenQuestions: (completion: unknown) => boolean
  readonly projectOpenQuestions: (
    completion: unknown
  ) => RegisteredOpenQuestionProjection | null
}

export interface RegisteredTaskKind<
  TKind extends string = string,
  TBrief = unknown,
  TResult = unknown,
  TCompletion extends RegisteredTaskCompletion = RegisteredTaskCompletion,
  TClaimContext = unknown,
> {
  readonly acceptsPlanRouteOrigin: false
  readonly activation: 'automatic'
  readonly briefSchema: z.ZodType<TBrief>
  readonly budgetClass: 'standard'
  readonly buildTaskPrompt: (input: {
    readonly claimContext: TClaimContext
    readonly intentSnapshot: TaskIntentSnapshot
    readonly kind: TKind
    readonly payload: TBrief
  }) => string
  readonly claimContextSchema: z.ZodType<TClaimContext>
  readonly completionResultSchema: z.ZodType<TResult>
  readonly completionSchema: z.ZodType<TCompletion>
  readonly effectPhase: 'graph-internal'
  readonly executionMode: 'agent'
  readonly intentAcceptance: 'ineligible'
  readonly kind: TKind
  readonly outputContract: readonly string[]
  readonly questionPolicy: RegisteredTaskQuestionPolicy | null
  readonly requiredOutputObjectIds: (result: unknown) => readonly string[]
  readonly requires: readonly []
  readonly schedulableBy: readonly ['agent']
  readonly subjectKey: (payload: unknown) => string
  readonly workerKey: AgentKey
}

export interface RegisteredAgent {
  readonly actorKey: `agent:${AgentKey}`
  readonly consultationTargets: readonly AgentKey[]
  readonly defaultModelProfileKey: string
  readonly description: string
  readonly displayName: string
  readonly key: AgentKey
  readonly reportingFeature: string
  readonly status: 'functional' | 'health-only'
  readonly taskKinds: readonly RegisteredTaskKindKey[]
}

export const PHASE_ZERO_MODEL_PROFILE_KEY = 'deepseek-v4-pro-0813'
export const GLOBAL_MODEL_PROFILE_KEY = PHASE_ZERO_MODEL_PROFILE_KEY

export const modelProfiles = {
  [PHASE_ZERO_MODEL_PROFILE_KEY]: {
    contextWindowTokens: 1_000_000,
    key: PHASE_ZERO_MODEL_PROFILE_KEY,
    model: 'deepseek/deepseek-v4-pro-0813',
    modelOptions: {
      providerOptions: {
        gateway: {},
      },
    },
  },
} as const satisfies Readonly<Record<string, ModelProfile>>

const productMarketerTaskKind = {
  acceptsPlanRouteOrigin: false,
  activation: 'automatic',
  briefSchema: productMarketerPayloadSchema,
  budgetClass: 'standard',
  buildTaskPrompt: buildProductMarketerTaskPrompt,
  claimContextSchema: productMarketerClaimContextSchema,
  completionResultSchema: productMarketerResultSchema,
  completionSchema: productMarketerCompletionSchema,
  effectPhase: 'graph-internal',
  executionMode: 'agent',
  intentAcceptance: 'ineligible',
  kind: PRODUCT_MARKETER_TASK_KIND,
  outputContract: ['brand_context'],
  questionPolicy: {
    hasOpenQuestions: (completion: unknown) =>
      hasOpenProductMarketerQuestions(
        productMarketerCompletionSchema.parse(completion)
      ),
    projectOpenQuestions: (completion: unknown) => {
      const parsed = productMarketerCompletionSchema.parse(completion)
      if (parsed.status === 'completed') {
        return null
      }
      return {
        questions: parsed.openQuestions,
        reason: parsed.result.reason,
        status: parsed.status,
        summary: parsed.summary,
      }
    },
  },
  requiredOutputObjectIds: (result: unknown) =>
    requiredProductMarketerOutputIds(productMarketerResultSchema.parse(result)),
  requires: [],
  schedulableBy: ['agent'],
  subjectKey: (payload: unknown) => {
    productMarketerPayloadSchema.parse(payload)
    return `${PRODUCT_MARKETER_WORKER_KEY}:brand-context`
  },
  workerKey: PRODUCT_MARKETER_WORKER_KEY,
} as const satisfies RegisteredTaskKind<
  typeof PRODUCT_MARKETER_TASK_KIND,
  ProductMarketerPayload,
  ProductMarketerResult,
  ProductMarketerCompletion,
  ProductMarketerClaimContext
>

export const agentRegistry = {
  cmo: {
    actorKey: 'agent:cmo',
    consultationTargets: ['product-marketer'],
    defaultModelProfileKey: PHASE_ZERO_MODEL_PROFILE_KEY,
    description: 'Private strategic conversation and trusted work routing.',
    displayName: 'CMO',
    key: 'cmo',
    reportingFeature: 'conversation',
    status: 'functional',
    taskKinds: [],
  },
  content: {
    actorKey: 'agent:content',
    consultationTargets: [],
    defaultModelProfileKey: PHASE_ZERO_MODEL_PROFILE_KEY,
    description: 'Content specialist reserved for a later phase.',
    displayName: 'Content',
    key: 'content',
    reportingFeature: 'content',
    status: 'health-only',
    taskKinds: [],
  },
  distribution: {
    actorKey: 'agent:distribution',
    consultationTargets: [],
    defaultModelProfileKey: PHASE_ZERO_MODEL_PROFILE_KEY,
    description: 'Distribution specialist reserved for a later phase.',
    displayName: 'Distribution',
    key: 'distribution',
    reportingFeature: 'distribution',
    status: 'health-only',
    taskKinds: [],
  },
  growth: {
    actorKey: 'agent:growth',
    consultationTargets: [],
    defaultModelProfileKey: PHASE_ZERO_MODEL_PROFILE_KEY,
    description: 'Growth specialist reserved for a later phase.',
    displayName: 'Growth',
    key: 'growth',
    reportingFeature: 'growth',
    status: 'health-only',
    taskKinds: [],
  },
  lifecycle: {
    actorKey: 'agent:lifecycle',
    consultationTargets: [],
    defaultModelProfileKey: PHASE_ZERO_MODEL_PROFILE_KEY,
    description: 'Lifecycle specialist reserved for a later phase.',
    displayName: 'Lifecycle',
    key: 'lifecycle',
    reportingFeature: 'lifecycle',
    status: 'health-only',
    taskKinds: [],
  },
  'product-marketer': {
    actorKey: 'agent:product-marketer',
    consultationTargets: [],
    defaultModelProfileKey: PHASE_ZERO_MODEL_PROFILE_KEY,
    description: 'Product positioning and canonical Brand Context enrichment.',
    displayName: 'Product Marketer',
    key: 'product-marketer',
    reportingFeature: 'brand-context',
    status: 'functional',
    taskKinds: [PRODUCT_MARKETER_TASK_KIND],
  },
  'seo-discovery': {
    actorKey: 'agent:seo-discovery',
    consultationTargets: [],
    defaultModelProfileKey: PHASE_ZERO_MODEL_PROFILE_KEY,
    description: 'SEO discovery specialist reserved for a later phase.',
    displayName: 'SEO Discovery',
    key: 'seo-discovery',
    reportingFeature: 'seo-discovery',
    status: 'health-only',
    taskKinds: [],
  },
} as const satisfies Readonly<Record<AgentKey, RegisteredAgent>>

export const taskKindRegistry = {
  [productMarketerTaskKind.kind]: productMarketerTaskKind,
} as const

export type RegisteredTaskKindKey = keyof typeof taskKindRegistry

export type ClaimContextOf<TKind extends RegisteredTaskKindKey> = z.output<
  (typeof taskKindRegistry)[TKind]['claimContextSchema']
>

export type TaskPayloadOf<TKind extends RegisteredTaskKindKey> = z.output<
  (typeof taskKindRegistry)[TKind]['briefSchema']
>

export type RegisteredTaskCompletionValue = z.output<
  (typeof taskKindRegistry)[RegisteredTaskKindKey]['completionSchema']
>

export const REGISTERED_TASK_KIND_KEYS = [PRODUCT_MARKETER_TASK_KIND] as const

export const registeredTaskKindKeySchema = z.enum(REGISTERED_TASK_KIND_KEYS)

export const REGISTERED_QUESTION_TASK_KIND_KEYS =
  REGISTERED_TASK_KIND_KEYS.filter(
    (kind) => taskKindRegistry[kind].questionPolicy !== null
  )

export const getAgent = <TAgentKey extends AgentKey>(
  agentKey: TAgentKey
): (typeof agentRegistry)[TAgentKey] => agentRegistry[agentKey]

const isModelProfileKey = (
  profileKey: string
): profileKey is keyof typeof modelProfiles =>
  Object.hasOwn(modelProfiles, profileKey)

export const getModelProfile = (profileKey: string): ModelProfile | null =>
  isModelProfileKey(profileKey) ? modelProfiles[profileKey] : null

export const getTaskKind = <TKind extends RegisteredTaskKindKey>(
  kind: TKind
): (typeof taskKindRegistry)[TKind] => taskKindRegistry[kind]
