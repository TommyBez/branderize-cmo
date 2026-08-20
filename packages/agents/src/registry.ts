import type { AgentModelOptionsDefinition } from 'eve'
import { z } from 'zod'

import type { TaskIntentSnapshot } from './task-snapshot'
import {
  buildContentBriefTaskPrompt,
  buildDistributionChannelPlanTaskPrompt,
  buildProductMarketerTaskPrompt,
  buildSeoDiscoveryOpportunityTaskPrompt,
  CONTENT_BRIEF_TASK_KIND,
  CONTENT_WORKER_KEY,
  type ContentBriefClaimContext,
  type ContentBriefCompletion,
  type ContentBriefPayload,
  type ContentBriefResult,
  contentBriefClaimContextSchema,
  contentBriefCompletionSchema,
  contentBriefPayloadSchema,
  contentBriefResultSchema,
  DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
  DISTRIBUTION_WORKER_KEY,
  type DistributionChannelPlanClaimContext,
  type DistributionChannelPlanCompletion,
  type DistributionChannelPlanPayload,
  type DistributionChannelPlanResult,
  distributionChannelPlanClaimContextSchema,
  distributionChannelPlanCompletionSchema,
  distributionChannelPlanPayloadSchema,
  distributionChannelPlanResultSchema,
  hasOpenContentBriefQuestions,
  hasOpenDistributionChannelPlanQuestions,
  hasOpenProductMarketerQuestions,
  hasOpenSeoDiscoveryOpportunityQuestions,
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
  requiredContentBriefOutputIds,
  requiredDistributionChannelPlanOutputIds,
  requiredProductMarketerOutputIds,
  requiredSeoDiscoveryOpportunityOutputIds,
  SEO_DISCOVERY_OPPORTUNITY_TASK_KIND,
  SEO_DISCOVERY_WORKER_KEY,
  type SeoDiscoveryOpportunityClaimContext,
  type SeoDiscoveryOpportunityCompletion,
  type SeoDiscoveryOpportunityPayload,
  type SeoDiscoveryOpportunityResult,
  seoDiscoveryOpportunityClaimContextSchema,
  seoDiscoveryOpportunityCompletionSchema,
  seoDiscoveryOpportunityPayloadSchema,
  seoDiscoveryOpportunityResultSchema,
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
    readonly kind: string
    readonly payload: unknown
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

const graphInternalKindDefaults = {
  acceptsPlanRouteOrigin: false,
  activation: 'automatic',
  budgetClass: 'standard',
  effectPhase: 'graph-internal',
  executionMode: 'agent',
  intentAcceptance: 'ineligible',
  requires: [],
  schedulableBy: ['agent'],
} as const

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

const contentBriefTaskKind = {
  ...graphInternalKindDefaults,
  briefSchema: contentBriefPayloadSchema,
  buildTaskPrompt: buildContentBriefTaskPrompt,
  claimContextSchema: contentBriefClaimContextSchema,
  completionResultSchema: contentBriefResultSchema,
  completionSchema: contentBriefCompletionSchema,
  kind: CONTENT_BRIEF_TASK_KIND,
  outputContract: ['report'],
  questionPolicy: {
    hasOpenQuestions: (completion: unknown) =>
      hasOpenContentBriefQuestions(
        contentBriefCompletionSchema.parse(completion)
      ),
    projectOpenQuestions: (completion: unknown) => {
      const parsed = contentBriefCompletionSchema.parse(completion)
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
    requiredContentBriefOutputIds(contentBriefResultSchema.parse(result)),
  subjectKey: (payload: unknown) => {
    contentBriefPayloadSchema.parse(payload)
    return `${CONTENT_WORKER_KEY}:brief`
  },
  workerKey: CONTENT_WORKER_KEY,
} as const satisfies RegisteredTaskKind<
  typeof CONTENT_BRIEF_TASK_KIND,
  ContentBriefPayload,
  ContentBriefResult,
  ContentBriefCompletion,
  ContentBriefClaimContext
>

const distributionChannelPlanTaskKind = {
  ...graphInternalKindDefaults,
  briefSchema: distributionChannelPlanPayloadSchema,
  buildTaskPrompt: buildDistributionChannelPlanTaskPrompt,
  claimContextSchema: distributionChannelPlanClaimContextSchema,
  completionResultSchema: distributionChannelPlanResultSchema,
  completionSchema: distributionChannelPlanCompletionSchema,
  kind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
  outputContract: ['report'],
  questionPolicy: {
    hasOpenQuestions: (completion: unknown) =>
      hasOpenDistributionChannelPlanQuestions(
        distributionChannelPlanCompletionSchema.parse(completion)
      ),
    projectOpenQuestions: (completion: unknown) => {
      const parsed = distributionChannelPlanCompletionSchema.parse(completion)
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
    requiredDistributionChannelPlanOutputIds(
      distributionChannelPlanResultSchema.parse(result)
    ),
  subjectKey: (payload: unknown) => {
    const parsed = distributionChannelPlanPayloadSchema.parse(payload)
    if (parsed.sourceReportObjectId === undefined) {
      return `${DISTRIBUTION_WORKER_KEY}:channel-plan`
    }
    return `${DISTRIBUTION_WORKER_KEY}:channel-plan:${parsed.sourceReportObjectId}`
  },
  workerKey: DISTRIBUTION_WORKER_KEY,
} as const satisfies RegisteredTaskKind<
  typeof DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
  DistributionChannelPlanPayload,
  DistributionChannelPlanResult,
  DistributionChannelPlanCompletion,
  DistributionChannelPlanClaimContext
>

const seoDiscoveryOpportunityTaskKind = {
  ...graphInternalKindDefaults,
  briefSchema: seoDiscoveryOpportunityPayloadSchema,
  buildTaskPrompt: buildSeoDiscoveryOpportunityTaskPrompt,
  claimContextSchema: seoDiscoveryOpportunityClaimContextSchema,
  completionResultSchema: seoDiscoveryOpportunityResultSchema,
  completionSchema: seoDiscoveryOpportunityCompletionSchema,
  kind: SEO_DISCOVERY_OPPORTUNITY_TASK_KIND,
  outputContract: ['evidence'],
  questionPolicy: {
    hasOpenQuestions: (completion: unknown) =>
      hasOpenSeoDiscoveryOpportunityQuestions(
        seoDiscoveryOpportunityCompletionSchema.parse(completion)
      ),
    projectOpenQuestions: (completion: unknown) => {
      const parsed = seoDiscoveryOpportunityCompletionSchema.parse(completion)
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
    requiredSeoDiscoveryOpportunityOutputIds(
      seoDiscoveryOpportunityResultSchema.parse(result)
    ),
  subjectKey: (payload: unknown) => {
    seoDiscoveryOpportunityPayloadSchema.parse(payload)
    return `${SEO_DISCOVERY_WORKER_KEY}:opportunity`
  },
  workerKey: SEO_DISCOVERY_WORKER_KEY,
} as const satisfies RegisteredTaskKind<
  typeof SEO_DISCOVERY_OPPORTUNITY_TASK_KIND,
  SeoDiscoveryOpportunityPayload,
  SeoDiscoveryOpportunityResult,
  SeoDiscoveryOpportunityCompletion,
  SeoDiscoveryOpportunityClaimContext
>

export const agentRegistry = {
  cmo: {
    actorKey: 'agent:cmo',
    consultationTargets: [
      'product-marketer',
      'content',
      'distribution',
      'seo-discovery',
    ],
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
    description: 'Long-form briefs and prose from Brand Context.',
    displayName: 'Content',
    key: 'content',
    reportingFeature: 'content',
    status: 'functional',
    taskKinds: [CONTENT_BRIEF_TASK_KIND],
  },
  distribution: {
    actorKey: 'agent:distribution',
    consultationTargets: [],
    defaultModelProfileKey: PHASE_ZERO_MODEL_PROFILE_KEY,
    description: 'Channel plans that reach an audience.',
    displayName: 'Distribution',
    key: 'distribution',
    reportingFeature: 'distribution',
    status: 'functional',
    taskKinds: [DISTRIBUTION_CHANNEL_PLAN_TASK_KIND],
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
    description: 'Search opportunities and page evidence.',
    displayName: 'SEO Discovery',
    key: 'seo-discovery',
    reportingFeature: 'seo-discovery',
    status: 'functional',
    taskKinds: [SEO_DISCOVERY_OPPORTUNITY_TASK_KIND],
  },
} as const satisfies Readonly<Record<AgentKey, RegisteredAgent>>

export const taskKindRegistry = {
  [productMarketerTaskKind.kind]: productMarketerTaskKind,
  [contentBriefTaskKind.kind]: contentBriefTaskKind,
  [distributionChannelPlanTaskKind.kind]: distributionChannelPlanTaskKind,
  [seoDiscoveryOpportunityTaskKind.kind]: seoDiscoveryOpportunityTaskKind,
} as const

export type RegisteredTaskKindKey = keyof typeof taskKindRegistry

export const LATERAL_WORK_EDGES = [
  {
    sourceWorkerKey: CONTENT_WORKER_KEY,
    targetKind: DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
    targetWorkerKey: DISTRIBUTION_WORKER_KEY,
  },
] as const satisfies readonly {
  readonly sourceWorkerKey: AgentKey
  readonly targetKind: RegisteredTaskKindKey
  readonly targetWorkerKey: AgentKey
}[]

export type LateralWorkEdge = (typeof LATERAL_WORK_EDGES)[number]
export type LateralWorkTargetKind = LateralWorkEdge['targetKind']

export const LATERAL_WORK_TARGET_KIND_KEYS = [
  DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
] as const satisfies readonly [
  LateralWorkTargetKind,
  ...LateralWorkTargetKind[],
]

export const lateralWorkTargetKindSchema = z.enum(LATERAL_WORK_TARGET_KIND_KEYS)

export const resolveLateralWorkEdge = ({
  sourceWorkerKey,
  targetKind,
}: {
  readonly sourceWorkerKey: string
  readonly targetKind: string
}): LateralWorkEdge | null => {
  for (const edge of LATERAL_WORK_EDGES) {
    if (
      edge.sourceWorkerKey === sourceWorkerKey &&
      edge.targetKind === targetKind
    ) {
      return edge
    }
  }
  return null
}

export type ClaimContextOf<TKind extends RegisteredTaskKindKey> = {
  readonly [K in TKind]: z.output<
    (typeof taskKindRegistry)[K]['claimContextSchema']
  >
}[TKind]

export type TaskPayloadOf<TKind extends RegisteredTaskKindKey> = {
  readonly [K in TKind]: z.output<(typeof taskKindRegistry)[K]['briefSchema']>
}[TKind]

export type RegisteredTaskCompletionValue = {
  readonly [K in RegisteredTaskKindKey]: z.output<
    (typeof taskKindRegistry)[K]['completionSchema']
  >
}[RegisteredTaskKindKey]

export const REGISTERED_TASK_KIND_KEYS = [
  CONTENT_BRIEF_TASK_KIND,
  DISTRIBUTION_CHANNEL_PLAN_TASK_KIND,
  PRODUCT_MARKETER_TASK_KIND,
  SEO_DISCOVERY_OPPORTUNITY_TASK_KIND,
] as const

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
