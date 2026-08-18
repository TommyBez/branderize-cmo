import {
  type AgentModelOptionsDefinition,
  type DynamicResolveContext,
  defineDynamic,
} from 'eve'

import {
  type AgentKey,
  type AgentLane,
  agentRegistry,
  type DeploymentEnvironment,
  GLOBAL_MODEL_PROFILE_KEY,
  getModelProfile,
  type ModelProfile,
} from './registry'

const RESERVED_TAG_PREFIXES = ['agent:', 'env:', 'feature:', 'lane:'] as const
const BRAND_ATTRIBUTE = 'brand_id'

export interface CompleteModelSelection {
  readonly model: string
  readonly modelContextWindowTokens: number
  readonly modelOptions: AgentModelOptionsDefinition
}

export interface ModelResolutionFallback {
  readonly agentKey: AgentKey
  readonly brandId: string | null
  readonly reason:
    | 'missing_trusted_brand'
    | 'override_lookup_failed'
    | 'unknown_override'
}

export interface EveModelConfigDependencies {
  readonly loadActiveBrandProfileKey?: (
    brandId: string,
    agentKey: AgentKey
  ) => Promise<string | null>
  readonly onFallback?: (fallback: ModelResolutionFallback) => void
}

export interface EveModelConfigInput {
  readonly agentKey: AgentKey
  readonly environment: DeploymentEnvironment
  readonly lane: AgentLane
}

const readScalarAttribute = (
  context: DynamicResolveContext,
  source: 'current' | 'initiator'
): string | null => {
  const value = context.session.auth[source]?.attributes[BRAND_ATTRIBUTE]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export const readTrustedBrandId = (
  context: DynamicResolveContext
): string | null => {
  const initiatorBrandId = readScalarAttribute(context, 'initiator')
  const currentBrandId = readScalarAttribute(context, 'current')

  if (
    initiatorBrandId === null ||
    currentBrandId === null ||
    initiatorBrandId !== currentBrandId
  ) {
    return null
  }

  return initiatorBrandId
}

const isReservedTag = (tag: string): boolean =>
  RESERVED_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix))

const readExistingTags = (
  options: AgentModelOptionsDefinition | undefined
): readonly string[] => {
  const tags = options?.providerOptions?.gateway?.tags
  if (!Array.isArray(tags)) {
    return []
  }

  return tags.filter(
    (tag): tag is string => typeof tag === 'string' && !isReservedTag(tag)
  )
}

export const withGatewayAttribution = ({
  agentKey,
  brandId,
  environment,
  lane,
  profile,
}: EveModelConfigInput & {
  readonly brandId: string
  readonly profile: ModelProfile
}): CompleteModelSelection => {
  const providerOptions = profile.modelOptions?.providerOptions ?? {}
  const gatewayOptions = providerOptions.gateway ?? {}
  const tags = [
    ...readExistingTags(profile.modelOptions),
    `agent:${agentKey}`,
    `env:${environment}`,
    `feature:${agentRegistry[agentKey].reportingFeature}`,
    `lane:${lane}`,
  ]
  const uniqueTags = Array.from(new Set(tags)).sort()

  return {
    model: profile.model,
    modelContextWindowTokens: profile.contextWindowTokens,
    modelOptions: {
      providerOptions: {
        ...providerOptions,
        gateway: {
          ...gatewayOptions,
          tags: uniqueTags,
          user: brandId,
        },
      },
    },
  }
}

const withoutBrandAttribution = (
  profile: ModelProfile
): CompleteModelSelection => ({
  model: profile.model,
  modelContextWindowTokens: profile.contextWindowTokens,
  modelOptions: profile.modelOptions ?? {},
})

const resolveRegisteredProfile = async ({
  agentKey,
  brandId,
  dependencies,
}: {
  readonly agentKey: AgentKey
  readonly brandId: string
  readonly dependencies: EveModelConfigDependencies
}): Promise<ModelProfile> => {
  const specialistProfile = getModelProfile(
    agentRegistry[agentKey].defaultModelProfileKey
  )
  const globalProfile = getModelProfile(GLOBAL_MODEL_PROFILE_KEY)

  if (!(specialistProfile && globalProfile)) {
    throw new Error('The compiled model registry is invalid')
  }

  const { loadActiveBrandProfileKey } = dependencies
  if (loadActiveBrandProfileKey === undefined) {
    return specialistProfile
  }

  try {
    const profileKey = await loadActiveBrandProfileKey(brandId, agentKey)
    if (profileKey === null) {
      return specialistProfile
    }

    const override = getModelProfile(profileKey)
    if (override === null) {
      dependencies.onFallback?.({
        agentKey,
        brandId,
        reason: 'unknown_override',
      })
      return specialistProfile
    }

    return override
  } catch {
    dependencies.onFallback?.({
      agentKey,
      brandId,
      reason: 'override_lookup_failed',
    })
    return globalProfile
  }
}

export const createEveModelConfig = (
  input: EveModelConfigInput,
  dependencies: EveModelConfigDependencies = {}
) => {
  const globalProfile = getModelProfile(GLOBAL_MODEL_PROFILE_KEY)
  if (globalProfile === null) {
    throw new Error('The global model profile is missing')
  }

  return defineDynamic({
    events: {
      'session.started': async (
        _event: unknown,
        context: DynamicResolveContext
      ): Promise<CompleteModelSelection> => {
        const brandId = readTrustedBrandId(context)
        if (brandId === null) {
          dependencies.onFallback?.({
            agentKey: input.agentKey,
            brandId: null,
            reason: 'missing_trusted_brand',
          })
          return withoutBrandAttribution(globalProfile)
        }

        const profile = await resolveRegisteredProfile({
          agentKey: input.agentKey,
          brandId,
          dependencies,
        })
        return withGatewayAttribution({ ...input, brandId, profile })
      },
    },
    fallback: globalProfile.model,
  })
}
