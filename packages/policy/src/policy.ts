export const POLICY_VERSION = 'phase-0-v1' as const

export type StructureLevel = 'low' | 'medium' | 'high'

export type PolicyVerdict =
  | 'allowed'
  | 'requires-verification'
  | 'requires-human-approval'
  | 'denied'

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer'

export type CommitmentEffectClass =
  | 'reversible-external'
  | 'communication'
  | 'irreversible-external'
  | 'financial'

export type PolicyEffectClass =
  | 'graph-internal'
  | 'external-preparation'
  | CommitmentEffectClass

export type EffectSignature =
  | Readonly<{ phase: 'graph-internal' }>
  | Readonly<{ phase: 'external-preparation' }>
  | Readonly<{
      phase: 'external-commitment'
      class: CommitmentEffectClass
    }>

export type ActorIdentity =
  | Readonly<{ kind: 'human'; actorKey: string }>
  | Readonly<{ kind: 'agent'; actorKey: string }>
  | Readonly<{ kind: 'system'; actorKey: string }>

export type MemberAuthorizationMode =
  | 'direct-mutation'
  | 'cmo-transduction'
  | 'commitment-approval'

export type CurrentMembership =
  | Readonly<{ kind: 'current'; role: MemberRole }>
  | Readonly<{ kind: 'absent' }>

export type SystemOperationAuthorization =
  | Readonly<{
      kind: 'system-operation'
      operation: 'context-dev-bootstrap'
      systemActorKey: 'system:context-dev'
    }>
  | Readonly<{
      kind: 'system-operation'
      operation: 'schedule-occurrence-evaluation'
      systemActorKey: 'system:schedule-dispatcher'
    }>

export type SystemOperation = SystemOperationAuthorization['operation']

export type AuthorizationContext =
  | Readonly<{ kind: 'autonomous' }>
  | Readonly<{
      kind: 'member'
      mode: MemberAuthorizationMode
      humanActorKey: string
      membership: CurrentMembership
    }>
  | SystemOperationAuthorization

export type CapabilityContext =
  | Readonly<{ kind: 'not-required' }>
  | Readonly<{ kind: 'granted'; capabilityKey: string }>
  | Readonly<{ kind: 'missing'; capabilityKey: string }>

export type IntentStatus = 'draft' | 'active' | 'settled' | 'abandoned'

export type CurrentPreauthorization = Readonly<{
  decisionId: string
  headStatus: 'current' | 'superseded'
  authorized: boolean
  brandId: string
  intentId: string
  authorizedIntentRevision: number | null
  appliesToEffect: boolean
}>

export type CurrentIntentStructure = Readonly<{
  brandId: string
  intentId: string
  status: IntentStatus
  revision: number
  acceptanceCriteria: readonly unknown[] | null
  constraints: readonly unknown[] | null
  preauthorizations: readonly CurrentPreauthorization[]
}>

export type SnapshotPreauthorization = Readonly<{
  decisionId: string
  authorizedIntentRevision: number
}>

export type IntentStructureSnapshot = Readonly<{
  brandId: string
  intentId: string
  intentRevision: number
  acceptanceCriteria: readonly unknown[] | null
  constraints: readonly unknown[] | null
  preauthorizations: readonly SnapshotPreauthorization[]
}>

export type PolicyOrigin =
  | Readonly<{ kind: 'new-intent-work'; intent: CurrentIntentStructure }>
  | Readonly<{
      kind: 'accepted-intent-work'
      snapshot: IntentStructureSnapshot
    }>
  | Readonly<{ kind: 'brand-administration' }>
  | Readonly<{ kind: 'plan-route' }>
  | Readonly<{ kind: 'origin-free' }>

export type SelectedPreauthorization = Readonly<{
  decisionId: string
  authorizedIntentRevision: number
}>

export type InvalidStructureReason =
  | 'intent-not-active'
  | 'invalid-intent-identity'
  | 'invalid-intent-revision'
  | 'invalid-policy-origin'
  | 'invalid-structure-fields'
  | 'invalid-snapshot-preauthorization'

export type StructureDerivation =
  | Readonly<{
      valid: true
      structureLevel: StructureLevel | null
      selectedPreauthorizations: readonly SelectedPreauthorization[]
    }>
  | Readonly<{
      valid: false
      structureLevel: null
      selectedPreauthorizations: readonly []
      reason: InvalidStructureReason
    }>

export type RestrictionVerdict = Exclude<PolicyVerdict, 'allowed'>

/**
 * A trusted Decision selector supplies only current restrictions that apply to
 * the exact operation. The union has no permissive variant, so it cannot widen
 * the default matrix.
 */
export type ApplicableBrandRestriction = Readonly<{
  decisionId: string
  verdict: RestrictionVerdict
}>

export type PolicyReason =
  | 'policy-matrix'
  | 'brand-restriction'
  | 'human-approval-satisfied'
  | 'current-membership-required'
  | 'viewer-read-only'
  | 'actor-authorization-mismatch'
  | 'system-operation-not-allowed'
  | 'capability-required'
  | 'capability-missing'
  | 'human-role-cannot-approve'
  | 'invalid-policy-input'
  | InvalidStructureReason

export type PolicyDecision = Readonly<{
  policyVersion: typeof POLICY_VERSION
  verdict: PolicyVerdict
  reason: PolicyReason
  structureLevel: StructureLevel | null
  memberRole: MemberRole | null
  selectedPreauthorizations: readonly SelectedPreauthorization[]
  restrictionDecisionIds: readonly string[]
}>

export type EvaluatePolicyInput = Readonly<{
  actor: ActorIdentity
  authorization: AuthorizationContext
  origin: PolicyOrigin
  effect: EffectSignature
  capability: CapabilityContext
  currentBrandRestrictions: readonly ApplicableBrandRestriction[]
}>

const ALLOWED = 'allowed' as const
const REQUIRES_HUMAN_APPROVAL = 'requires-human-approval' as const

export const PHASE_0_POLICY_MATRIX = {
  communication: {
    high: REQUIRES_HUMAN_APPROVAL,
    low: REQUIRES_HUMAN_APPROVAL,
    medium: REQUIRES_HUMAN_APPROVAL,
  },
  'external-preparation': {
    high: ALLOWED,
    low: ALLOWED,
    medium: ALLOWED,
  },
  financial: {
    high: REQUIRES_HUMAN_APPROVAL,
    low: REQUIRES_HUMAN_APPROVAL,
    medium: REQUIRES_HUMAN_APPROVAL,
  },
  'graph-internal': {
    high: ALLOWED,
    low: ALLOWED,
    medium: ALLOWED,
  },
  'irreversible-external': {
    high: REQUIRES_HUMAN_APPROVAL,
    low: REQUIRES_HUMAN_APPROVAL,
    medium: REQUIRES_HUMAN_APPROVAL,
  },
  'reversible-external': {
    high: REQUIRES_HUMAN_APPROVAL,
    low: REQUIRES_HUMAN_APPROVAL,
    medium: REQUIRES_HUMAN_APPROVAL,
  },
} as const satisfies Readonly<
  Record<PolicyEffectClass, Readonly<Record<StructureLevel, PolicyVerdict>>>
>

const VERDICT_RANK = {
  allowed: 0,
  denied: 3,
  'requires-human-approval': 2,
  'requires-verification': 1,
} as const satisfies Readonly<Record<PolicyVerdict, number>>

const invalidStructure = (
  reason: InvalidStructureReason
): StructureDerivation => ({
  reason,
  selectedPreauthorizations: [],
  structureLevel: null,
  valid: false,
})

const isNonBlank = (value: string): boolean => value.trim().length > 0

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0

const validateStructureFields = (
  acceptanceCriteria: readonly unknown[] | null,
  constraints: readonly unknown[] | null
): InvalidStructureReason | null => {
  if (acceptanceCriteria !== null && acceptanceCriteria.length === 0) {
    return 'invalid-structure-fields'
  }
  if (constraints !== null && constraints.length === 0) {
    return 'invalid-structure-fields'
  }
  if (acceptanceCriteria === null && constraints !== null) {
    return 'invalid-structure-fields'
  }
  return null
}

const deriveLevel = (
  acceptanceCriteria: readonly unknown[] | null,
  constraints: readonly unknown[] | null,
  selectedPreauthorizations: readonly SelectedPreauthorization[]
): StructureLevel => {
  if (acceptanceCriteria === null) {
    return 'low'
  }
  if (constraints !== null && selectedPreauthorizations.length > 0) {
    return 'high'
  }
  return 'medium'
}

const hasDuplicateDecisionId = (
  preauthorizations: readonly { decisionId: string }[]
): boolean => {
  const observed = new Set<string>()
  for (const preauthorization of preauthorizations) {
    if (observed.has(preauthorization.decisionId)) {
      return true
    }
    observed.add(preauthorization.decisionId)
  }
  return false
}

const deriveCurrentIntentStructure = (
  intent: CurrentIntentStructure
): StructureDerivation => {
  if (!(isNonBlank(intent.brandId) && isNonBlank(intent.intentId))) {
    return invalidStructure('invalid-intent-identity')
  }
  if (!isPositiveInteger(intent.revision)) {
    return invalidStructure('invalid-intent-revision')
  }
  if (intent.status !== 'active') {
    return invalidStructure('intent-not-active')
  }
  const invalidFields = validateStructureFields(
    intent.acceptanceCriteria,
    intent.constraints
  )
  if (invalidFields !== null) {
    return invalidStructure(invalidFields)
  }
  if (hasDuplicateDecisionId(intent.preauthorizations)) {
    return invalidStructure('invalid-snapshot-preauthorization')
  }

  const selectedPreauthorizations: SelectedPreauthorization[] = []
  for (const preauthorization of intent.preauthorizations) {
    const appliesToCurrentIntent =
      preauthorization.headStatus === 'current' &&
      preauthorization.authorized &&
      preauthorization.brandId === intent.brandId &&
      preauthorization.intentId === intent.intentId &&
      preauthorization.authorizedIntentRevision === intent.revision &&
      preauthorization.appliesToEffect &&
      isNonBlank(preauthorization.decisionId)

    if (appliesToCurrentIntent) {
      selectedPreauthorizations.push({
        authorizedIntentRevision: intent.revision,
        decisionId: preauthorization.decisionId,
      })
    }
  }
  selectedPreauthorizations.sort((left, right) =>
    left.decisionId.localeCompare(right.decisionId)
  )

  return {
    selectedPreauthorizations,
    structureLevel: deriveLevel(
      intent.acceptanceCriteria,
      intent.constraints,
      selectedPreauthorizations
    ),
    valid: true,
  }
}

const deriveSnapshotStructure = (
  snapshot: IntentStructureSnapshot
): StructureDerivation => {
  if (!(isNonBlank(snapshot.brandId) && isNonBlank(snapshot.intentId))) {
    return invalidStructure('invalid-intent-identity')
  }
  if (!isPositiveInteger(snapshot.intentRevision)) {
    return invalidStructure('invalid-intent-revision')
  }
  const invalidFields = validateStructureFields(
    snapshot.acceptanceCriteria,
    snapshot.constraints
  )
  if (invalidFields !== null) {
    return invalidStructure(invalidFields)
  }
  if (hasDuplicateDecisionId(snapshot.preauthorizations)) {
    return invalidStructure('invalid-snapshot-preauthorization')
  }

  const selectedPreauthorizations: SelectedPreauthorization[] = []
  for (const preauthorization of snapshot.preauthorizations) {
    const isValidSnapshotEntry =
      isNonBlank(preauthorization.decisionId) &&
      isPositiveInteger(preauthorization.authorizedIntentRevision) &&
      preauthorization.authorizedIntentRevision === snapshot.intentRevision

    if (!isValidSnapshotEntry) {
      return invalidStructure('invalid-snapshot-preauthorization')
    }
    selectedPreauthorizations.push({ ...preauthorization })
  }
  selectedPreauthorizations.sort((left, right) =>
    left.decisionId.localeCompare(right.decisionId)
  )

  return {
    selectedPreauthorizations,
    structureLevel: deriveLevel(
      snapshot.acceptanceCriteria,
      snapshot.constraints,
      selectedPreauthorizations
    ),
    valid: true,
  }
}

export const deriveStructureLevel = (
  origin: PolicyOrigin
): StructureDerivation => {
  switch (origin.kind) {
    case 'new-intent-work':
      return deriveCurrentIntentStructure(origin.intent)
    case 'accepted-intent-work':
      return deriveSnapshotStructure(origin.snapshot)
    case 'brand-administration':
    case 'plan-route':
    case 'origin-free':
      return {
        selectedPreauthorizations: [],
        structureLevel: null,
        valid: true,
      }
    default:
      return invalidStructure('invalid-policy-origin')
  }
}

const effectClassOf = (effect: EffectSignature): PolicyEffectClass | null => {
  switch (effect.phase) {
    case 'graph-internal':
      return 'graph-internal'
    case 'external-preparation':
      return 'external-preparation'
    case 'external-commitment':
      return effect.class
    default:
      return null
  }
}

const currentMemberRole = (
  authorization: AuthorizationContext
): MemberRole | null => {
  if (
    authorization.kind !== 'member' ||
    authorization.membership.kind !== 'current'
  ) {
    return null
  }
  return authorization.membership.role
}

type ActorGate =
  | Readonly<{ allowed: true; role: MemberRole | null }>
  | Readonly<{ allowed: false; reason: PolicyReason; role: MemberRole | null }>

const actorDenied = (
  reason: PolicyReason,
  role: MemberRole | null = null
): ActorGate => ({ allowed: false, reason, role })

const authorizeAutonomousActor = (actor: ActorIdentity): ActorGate =>
  actor.kind === 'agent'
    ? { allowed: true, role: null }
    : actorDenied('actor-authorization-mismatch')

const authorizeSystemActor = (
  actor: ActorIdentity,
  authorization: Extract<AuthorizationContext, { kind: 'system-operation' }>,
  effect: EffectSignature
): ActorGate => {
  const isRegisteredOperation =
    authorization.operation === 'context-dev-bootstrap' ||
    authorization.operation === 'schedule-occurrence-evaluation'
  const operationMatchesActor =
    isRegisteredOperation &&
    actor.kind === 'system' &&
    actor.actorKey === authorization.systemActorKey
  if (!operationMatchesActor) {
    return actorDenied('actor-authorization-mismatch')
  }
  if (effect.phase !== 'graph-internal') {
    return actorDenied('system-operation-not-allowed')
  }
  return { allowed: true, role: null }
}

const authorizeMemberActor = (
  actor: ActorIdentity,
  authorization: Extract<AuthorizationContext, { kind: 'member' }>,
  effect: EffectSignature
): ActorGate => {
  if (authorization.membership.kind === 'absent') {
    return actorDenied('current-membership-required')
  }
  const { role } = authorization.membership
  if (role === 'viewer') {
    return actorDenied('viewer-read-only', role)
  }
  const isDirectHuman =
    actor.kind === 'human' && actor.actorKey === authorization.humanActorKey
  const isCmoTransduction = actor.kind === 'agent'
  const actorMatchesMode =
    (authorization.mode === 'direct-mutation' && isDirectHuman) ||
    (authorization.mode === 'commitment-approval' && isDirectHuman) ||
    (authorization.mode === 'cmo-transduction' && isCmoTransduction)
  if (!(actorMatchesMode && isNonBlank(authorization.humanActorKey))) {
    return actorDenied('actor-authorization-mismatch', role)
  }
  const isApprovalForCommitment =
    authorization.mode !== 'commitment-approval' ||
    effect.phase === 'external-commitment'
  if (!isApprovalForCommitment) {
    return actorDenied('actor-authorization-mismatch', role)
  }
  return { allowed: true, role }
}

const authorizeActor = (
  actor: ActorIdentity,
  authorization: AuthorizationContext,
  effect: EffectSignature
): ActorGate => {
  if (!isNonBlank(actor.actorKey)) {
    return actorDenied('invalid-policy-input')
  }

  switch (authorization.kind) {
    case 'autonomous':
      return authorizeAutonomousActor(actor)
    case 'system-operation':
      return authorizeSystemActor(actor, authorization, effect)
    case 'member':
      return authorizeMemberActor(actor, authorization, effect)
    default:
      return actorDenied('invalid-policy-input')
  }
}

const capabilityDenial = (
  actor: ActorIdentity,
  capability: CapabilityContext
): PolicyReason | null => {
  if (capability.kind === 'missing') {
    return isNonBlank(capability.capabilityKey)
      ? 'capability-missing'
      : 'invalid-policy-input'
  }
  if (capability.kind === 'granted') {
    return isNonBlank(capability.capabilityKey) ? null : 'invalid-policy-input'
  }
  return actor.kind === 'agent' ? 'capability-required' : null
}

type RestrictionEvaluation =
  | Readonly<{
      valid: true
      verdict: PolicyVerdict
      decisionIds: readonly string[]
    }>
  | Readonly<{ valid: false }>

const applyRestrictions = (
  baseVerdict: PolicyVerdict,
  restrictions: readonly ApplicableBrandRestriction[]
): RestrictionEvaluation => {
  const observed = new Set<string>()
  const decisionIds: string[] = []
  let verdict = baseVerdict

  for (const restriction of restrictions) {
    const { decisionId, verdict: restrictionVerdict } = restriction
    if (!isNonBlank(decisionId) || observed.has(decisionId)) {
      return { valid: false }
    }
    observed.add(decisionId)
    decisionIds.push(decisionId)
    if (VERDICT_RANK[restrictionVerdict] > VERDICT_RANK[verdict]) {
      verdict = restrictionVerdict
    }
  }
  decisionIds.sort((left, right) => left.localeCompare(right))

  return { decisionIds, valid: true, verdict }
}

const deniedDecision = (
  reason: PolicyReason,
  structure: StructureDerivation,
  memberRole: MemberRole | null,
  restrictionDecisionIds: readonly string[] = []
): PolicyDecision => ({
  memberRole,
  policyVersion: POLICY_VERSION,
  reason,
  restrictionDecisionIds,
  selectedPreauthorizations: structure.selectedPreauthorizations,
  structureLevel: structure.structureLevel,
  verdict: 'denied',
})

const canApproveCommitment = (
  role: MemberRole,
  effect: EffectSignature
): boolean => {
  if (effect.phase !== 'external-commitment') {
    return false
  }
  if (role === 'owner' || role === 'admin') {
    return true
  }
  return role === 'member' && effect.class !== 'financial'
}

export const evaluatePolicy = (input: EvaluatePolicyInput): PolicyDecision => {
  const structure = deriveStructureLevel(input.origin)
  const memberRole = currentMemberRole(input.authorization)
  if (!structure.valid) {
    return deniedDecision(structure.reason, structure, memberRole)
  }

  const actorGate = authorizeActor(
    input.actor,
    input.authorization,
    input.effect
  )
  if (!actorGate.allowed) {
    return deniedDecision(actorGate.reason, structure, actorGate.role)
  }

  const capabilityReason = capabilityDenial(input.actor, input.capability)
  if (capabilityReason !== null) {
    return deniedDecision(capabilityReason, structure, actorGate.role)
  }

  const effectClass = effectClassOf(input.effect)
  if (effectClass === null) {
    return deniedDecision('invalid-policy-input', structure, actorGate.role)
  }
  const matrixLevel = structure.structureLevel ?? 'low'
  const baseVerdict = PHASE_0_POLICY_MATRIX[effectClass][matrixLevel]
  const restricted = applyRestrictions(
    baseVerdict,
    input.currentBrandRestrictions
  )
  if (!restricted.valid) {
    return deniedDecision('invalid-policy-input', structure, actorGate.role)
  }
  if (restricted.verdict === 'denied') {
    return deniedDecision(
      'brand-restriction',
      structure,
      actorGate.role,
      restricted.decisionIds
    )
  }

  if (
    restricted.verdict === 'requires-human-approval' &&
    input.authorization.kind === 'member' &&
    input.authorization.mode === 'commitment-approval'
  ) {
    if (input.authorization.membership.kind !== 'current') {
      return deniedDecision(
        'current-membership-required',
        structure,
        null,
        restricted.decisionIds
      )
    }
    const { role } = input.authorization.membership
    if (!canApproveCommitment(role, input.effect)) {
      return deniedDecision(
        'human-role-cannot-approve',
        structure,
        role,
        restricted.decisionIds
      )
    }
    return {
      memberRole: role,
      policyVersion: POLICY_VERSION,
      reason: 'human-approval-satisfied',
      restrictionDecisionIds: restricted.decisionIds,
      selectedPreauthorizations: structure.selectedPreauthorizations,
      structureLevel: structure.structureLevel,
      verdict: 'allowed',
    }
  }

  return {
    memberRole: actorGate.role,
    policyVersion: POLICY_VERSION,
    reason:
      restricted.decisionIds.length > 0 ? 'brand-restriction' : 'policy-matrix',
    restrictionDecisionIds: restricted.decisionIds,
    selectedPreauthorizations: structure.selectedPreauthorizations,
    structureLevel: structure.structureLevel,
    verdict: restricted.verdict,
  }
}
