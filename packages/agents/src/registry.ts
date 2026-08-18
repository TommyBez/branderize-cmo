import type { AgentModelOptionsDefinition } from 'eve'
import type { z } from 'zod'

import {
  type ProductMarketerResult,
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

export interface RegisteredTaskKind {
  readonly acceptsPlanRouteOrigin: false
  readonly activation: 'automatic'
  readonly briefSchema: z.ZodType
  readonly budgetClass: 'standard'
  readonly completionResultSchema: z.ZodType
  readonly effectPhase: 'graph-internal'
  readonly executionMode: 'agent'
  readonly intentAcceptance: 'ineligible'
  readonly kind: 'product-marketer.brand-context.v1'
  readonly outputContract: readonly ['brand_context']
  readonly requiredOutputObjectIds: (
    result: ProductMarketerResult
  ) => readonly string[]
  readonly requires: readonly []
  readonly schedulableBy: readonly ['agent']
  readonly subjectKey: 'product-marketer:brand-context'
  readonly workerKey: 'product-marketer'
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
  readonly taskKinds: readonly RegisteredTaskKind[]
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
  completionResultSchema: productMarketerResultSchema,
  effectPhase: 'graph-internal',
  executionMode: 'agent',
  intentAcceptance: 'ineligible',
  kind: 'product-marketer.brand-context.v1',
  outputContract: ['brand_context'],
  requiredOutputObjectIds: requiredProductMarketerOutputIds,
  requires: [],
  schedulableBy: ['agent'],
  subjectKey: 'product-marketer:brand-context',
  workerKey: 'product-marketer',
} as const

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
    taskKinds: [productMarketerTaskKind],
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

export const getAgent = (agentKey: AgentKey): RegisteredAgent =>
  agentRegistry[agentKey]

const isModelProfileKey = (
  profileKey: string
): profileKey is keyof typeof modelProfiles =>
  Object.hasOwn(modelProfiles, profileKey)

export const getModelProfile = (profileKey: string): ModelProfile | null =>
  isModelProfileKey(profileKey) ? modelProfiles[profileKey] : null

export const getTaskKind = (kind: RegisteredTaskKindKey): RegisteredTaskKind =>
  taskKindRegistry[kind]
