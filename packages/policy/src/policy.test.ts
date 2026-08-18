import { describe, expect, it } from 'vitest'
import type {
  ActorIdentity,
  ApplicableBrandRestriction,
  AuthorizationContext,
  CommitmentEffectClass,
  CurrentIntentStructure,
  CurrentPreauthorization,
  EffectSignature,
  EvaluatePolicyInput,
  IntentStructureSnapshot,
  MemberRole,
  PolicyEffectClass,
  PolicyOrigin,
  PolicyVerdict,
  StructureLevel,
} from './policy'
import {
  deriveStructureLevel,
  evaluatePolicy,
  PHASE_0_POLICY_MATRIX,
  POLICY_VERSION,
} from './policy'

const HUMAN_ACTOR = {
  actorKey: 'human:user-1',
  kind: 'human',
} as const satisfies ActorIdentity

const CMO_ACTOR = {
  actorKey: 'cmo',
  kind: 'agent',
} as const satisfies ActorIdentity

const CONTEXT_DEV_ACTOR = {
  actorKey: 'system:context-dev',
  kind: 'system',
} as const satisfies ActorIdentity

const GRANTED_CAPABILITY = {
  capabilityKey: 'graph:write',
  kind: 'granted',
} as const

const ORIGIN_FREE = { kind: 'origin-free' } as const satisfies PolicyOrigin

const GRAPH_INTERNAL = {
  phase: 'graph-internal',
} as const satisfies EffectSignature

const currentMembership = (
  role: MemberRole,
  mode: 'direct-mutation' | 'cmo-transduction' | 'commitment-approval'
): AuthorizationContext => ({
  humanActorKey: HUMAN_ACTOR.actorKey,
  kind: 'member',
  membership: { kind: 'current', role },
  mode,
})

const acceptedIntentOrigin = (level: StructureLevel): PolicyOrigin => {
  const origins = {
    high: {
      kind: 'accepted-intent-work',
      snapshot: {
        acceptanceCriteria: [{ kind: 'criterion' }],
        brandId: 'brand-1',
        constraints: [{ kind: 'constraint' }],
        intentId: 'intent-1',
        intentRevision: 3,
        preauthorizations: [
          {
            authorizedIntentRevision: 3,
            decisionId: 'decision-1',
          },
        ],
      },
    },
    low: {
      kind: 'accepted-intent-work',
      snapshot: {
        acceptanceCriteria: null,
        brandId: 'brand-1',
        constraints: null,
        intentId: 'intent-1',
        intentRevision: 3,
        preauthorizations: [],
      },
    },
    medium: {
      kind: 'accepted-intent-work',
      snapshot: {
        acceptanceCriteria: [{ kind: 'criterion' }],
        brandId: 'brand-1',
        constraints: null,
        intentId: 'intent-1',
        intentRevision: 3,
        preauthorizations: [],
      },
    },
  } as const satisfies Readonly<Record<StructureLevel, PolicyOrigin>>

  return origins[level]
}

const evaluateAsAgent = (
  effect: EffectSignature = GRAPH_INTERNAL,
  origin: PolicyOrigin = ORIGIN_FREE,
  restrictions: readonly ApplicableBrandRestriction[] = []
) =>
  evaluatePolicy({
    actor: CMO_ACTOR,
    authorization: { kind: 'autonomous' },
    capability: GRANTED_CAPABILITY,
    currentBrandRestrictions: restrictions,
    effect,
    origin,
  })

const baseInput = (): EvaluatePolicyInput => ({
  actor: CMO_ACTOR,
  authorization: { kind: 'autonomous' },
  capability: GRANTED_CAPABILITY,
  currentBrandRestrictions: [],
  effect: GRAPH_INTERNAL,
  origin: ORIGIN_FREE,
})

const exactPreauthorization = (
  overrides: Partial<CurrentPreauthorization> = {}
): CurrentPreauthorization => ({
  appliesToEffect: true,
  authorized: true,
  authorizedIntentRevision: 3,
  brandId: 'brand-1',
  decisionId: 'decision-1',
  headStatus: 'current',
  intentId: 'intent-1',
  ...overrides,
})

const currentIntent = (
  overrides: Partial<CurrentIntentStructure> = {}
): CurrentIntentStructure => ({
  acceptanceCriteria: [{ kind: 'criterion' }],
  brandId: 'brand-1',
  constraints: [{ kind: 'constraint' }],
  intentId: 'intent-1',
  preauthorizations: [exactPreauthorization()],
  revision: 3,
  status: 'active',
  ...overrides,
})

const COMMITMENT_EFFECTS = [
  'reversible-external',
  'communication',
  'irreversible-external',
  'financial',
] as const satisfies readonly CommitmentEffectClass[]

const EFFECT_CASES = [
  {
    effectClass: 'graph-internal',
    expected: 'allowed',
    signature: { phase: 'graph-internal' },
  },
  {
    effectClass: 'external-preparation',
    expected: 'allowed',
    signature: { phase: 'external-preparation' },
  },
  {
    effectClass: 'reversible-external',
    expected: 'requires-human-approval',
    signature: {
      class: 'reversible-external',
      phase: 'external-commitment',
    },
  },
  {
    effectClass: 'communication',
    expected: 'requires-human-approval',
    signature: {
      class: 'communication',
      phase: 'external-commitment',
    },
  },
  {
    effectClass: 'irreversible-external',
    expected: 'requires-human-approval',
    signature: {
      class: 'irreversible-external',
      phase: 'external-commitment',
    },
  },
  {
    effectClass: 'financial',
    expected: 'requires-human-approval',
    signature: {
      class: 'financial',
      phase: 'external-commitment',
    },
  },
] as const satisfies readonly {
  effectClass: PolicyEffectClass
  signature: EffectSignature
  expected: PolicyVerdict
}[]

describe('structure derivation', () => {
  it('derives low, medium, and high without storing a level', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      const result = deriveStructureLevel(acceptedIntentOrigin(level))

      expect(result).toMatchObject({ structureLevel: level, valid: true })
    }
  })

  it('selects only exact current positive same-revision preauthorizations', () => {
    const result = deriveStructureLevel({
      intent: currentIntent({
        preauthorizations: [
          exactPreauthorization({ decisionId: 'decision-z' }),
          exactPreauthorization({ decisionId: 'decision-a' }),
        ],
      }),
      kind: 'new-intent-work',
    })

    expect(result).toEqual({
      selectedPreauthorizations: [
        { authorizedIntentRevision: 3, decisionId: 'decision-a' },
        { authorizedIntentRevision: 3, decisionId: 'decision-z' },
      ],
      structureLevel: 'high',
      valid: true,
    })
  })

  it('treats every stale, revoked, mismatched, or inapplicable grant as absent', () => {
    const inapplicableCandidates = [
      exactPreauthorization({ headStatus: 'superseded' }),
      exactPreauthorization({ authorized: false }),
      exactPreauthorization({ brandId: 'brand-2' }),
      exactPreauthorization({ intentId: 'intent-2' }),
      exactPreauthorization({ authorizedIntentRevision: 2 }),
      exactPreauthorization({ authorizedIntentRevision: null }),
      exactPreauthorization({ appliesToEffect: false }),
      exactPreauthorization({ decisionId: '' }),
    ]

    for (const preauthorization of inapplicableCandidates) {
      const result = deriveStructureLevel({
        intent: currentIntent({ preauthorizations: [preauthorization] }),
        kind: 'new-intent-work',
      })

      expect(result).toEqual({
        selectedPreauthorizations: [],
        structureLevel: 'medium',
        valid: true,
      })
    }
  })

  it('rejects every non-active Intent as an origin for new work', () => {
    for (const status of ['draft', 'settled', 'abandoned'] as const) {
      const result = deriveStructureLevel({
        intent: currentIntent({ status }),
        kind: 'new-intent-work',
      })

      expect(result).toEqual({
        reason: 'intent-not-active',
        selectedPreauthorizations: [],
        structureLevel: null,
        valid: false,
      })
    }
  })

  it('rejects malformed structural states instead of promoting them', () => {
    const malformed = [
      currentIntent({ acceptanceCriteria: [], constraints: null }),
      currentIntent({ acceptanceCriteria: null, constraints: [] }),
      currentIntent({
        acceptanceCriteria: null,
        constraints: [{ kind: 'constraint' }],
      }),
    ]

    for (const intent of malformed) {
      expect(
        deriveStructureLevel({ intent, kind: 'new-intent-work' })
      ).toMatchObject({
        reason: 'invalid-structure-fields',
        valid: false,
      })
    }
  })

  it('rejects invalid identities, revisions, duplicate grants, and corrupt snapshots', () => {
    expect(
      deriveStructureLevel({
        intent: currentIntent({ brandId: '' }),
        kind: 'new-intent-work',
      })
    ).toMatchObject({ reason: 'invalid-intent-identity', valid: false })
    expect(
      deriveStructureLevel({
        intent: currentIntent({ revision: 0 }),
        kind: 'new-intent-work',
      })
    ).toMatchObject({ reason: 'invalid-intent-revision', valid: false })
    expect(
      deriveStructureLevel({
        intent: currentIntent({
          preauthorizations: [exactPreauthorization(), exactPreauthorization()],
        }),
        kind: 'new-intent-work',
      })
    ).toMatchObject({
      reason: 'invalid-snapshot-preauthorization',
      valid: false,
    })

    const corruptSnapshot: IntentStructureSnapshot = {
      acceptanceCriteria: [{ kind: 'criterion' }],
      brandId: 'brand-1',
      constraints: [{ kind: 'constraint' }],
      intentId: 'intent-1',
      intentRevision: 3,
      preauthorizations: [
        { authorizedIntentRevision: 2, decisionId: 'decision-1' },
      ],
    }
    expect(
      deriveStructureLevel({
        kind: 'accepted-intent-work',
        snapshot: corruptSnapshot,
      })
    ).toMatchObject({
      reason: 'invalid-snapshot-preauthorization',
      valid: false,
    })
  })

  it('keeps every non-Intent origin explicitly unstructured', () => {
    const nonIntentOrigins = [
      { kind: 'brand-administration' },
      { kind: 'plan-route' },
      { kind: 'origin-free' },
    ] as const satisfies readonly PolicyOrigin[]

    for (const origin of nonIntentOrigins) {
      expect(deriveStructureLevel(origin)).toEqual({
        selectedPreauthorizations: [],
        structureLevel: null,
        valid: true,
      })
    }
  })
})

describe('Phase 0 default matrix', () => {
  it('covers every effect and structure cell', () => {
    for (const effectCase of EFFECT_CASES) {
      for (const level of ['low', 'medium', 'high'] as const) {
        const decision = evaluateAsAgent(
          effectCase.signature,
          acceptedIntentOrigin(level)
        )

        expect(decision.verdict).toBe(effectCase.expected)
        expect(PHASE_0_POLICY_MATRIX[effectCase.effectClass][level]).toBe(
          effectCase.expected
        )
      }
    }
  })

  it('treats null structure as no more permissive than low', () => {
    for (const effectCase of EFFECT_CASES) {
      const decision = evaluateAsAgent(effectCase.signature, ORIGIN_FREE)

      expect(decision.structureLevel).toBeNull()
      expect(decision.verdict).toBe(
        PHASE_0_POLICY_MATRIX[effectCase.effectClass].low
      )
    }
  })

  it('never lets high structure lower the commitment approval floor', () => {
    for (const effectClass of COMMITMENT_EFFECTS) {
      const decision = evaluateAsAgent(
        { class: effectClass, phase: 'external-commitment' },
        acceptedIntentOrigin('high')
      )

      expect(decision.verdict).toBe('requires-human-approval')
    }
  })
})

describe('actor and membership gates', () => {
  it('allows current owner, admin, and member graph writes but denies viewers', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const decision = evaluatePolicy({
        ...baseInput(),
        actor: HUMAN_ACTOR,
        authorization: currentMembership(role, 'direct-mutation'),
        capability: { kind: 'not-required' },
      })

      expect(decision.verdict).toBe(role === 'viewer' ? 'denied' : 'allowed')
    }
  })

  it('applies the same non-viewer boundary to CMO transduction', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      const decision = evaluatePolicy({
        ...baseInput(),
        authorization: currentMembership(role, 'cmo-transduction'),
      })

      expect(decision.verdict).toBe(role === 'viewer' ? 'denied' : 'allowed')
    }
  })

  it('denies a removed Member and never reads a role from the Actor', () => {
    const decision = evaluatePolicy({
      ...baseInput(),
      actor: HUMAN_ACTOR,
      authorization: {
        humanActorKey: HUMAN_ACTOR.actorKey,
        kind: 'member',
        membership: { kind: 'absent' },
        mode: 'direct-mutation',
      },
      capability: { kind: 'not-required' },
    })

    expect(decision).toMatchObject({
      memberRole: null,
      reason: 'current-membership-required',
      verdict: 'denied',
    })
  })

  it('denies mismatched direct, transduced, autonomous, and system identities', () => {
    const mismatches: EvaluatePolicyInput[] = [
      {
        ...baseInput(),
        actor: HUMAN_ACTOR,
        authorization: {
          humanActorKey: 'human:someone-else',
          kind: 'member',
          membership: { kind: 'current', role: 'owner' },
          mode: 'direct-mutation',
        },
        capability: { kind: 'not-required' },
      },
      {
        ...baseInput(),
        actor: HUMAN_ACTOR,
        authorization: currentMembership('owner', 'cmo-transduction'),
        capability: { kind: 'not-required' },
      },
      {
        ...baseInput(),
        actor: HUMAN_ACTOR,
        authorization: { kind: 'autonomous' },
        capability: { kind: 'not-required' },
      },
      {
        ...baseInput(),
        actor: CONTEXT_DEV_ACTOR,
        authorization: {
          kind: 'system-operation',
          operation: 'schedule-occurrence-evaluation',
          systemActorKey: 'system:schedule-dispatcher',
        },
        capability: { kind: 'not-required' },
      },
    ]

    for (const input of mismatches) {
      expect(evaluatePolicy(input)).toMatchObject({
        reason: 'actor-authorization-mismatch',
        verdict: 'denied',
      })
    }
  })

  it('allows only the exact registered graph-internal System operation', () => {
    const authorization = {
      kind: 'system-operation',
      operation: 'context-dev-bootstrap',
      systemActorKey: 'system:context-dev',
    } as const satisfies AuthorizationContext

    expect(
      evaluatePolicy({
        ...baseInput(),
        actor: CONTEXT_DEV_ACTOR,
        authorization,
        capability: { kind: 'not-required' },
      })
    ).toMatchObject({ verdict: 'allowed' })
    expect(
      evaluatePolicy({
        ...baseInput(),
        actor: CONTEXT_DEV_ACTOR,
        authorization,
        capability: { kind: 'not-required' },
        effect: { phase: 'external-preparation' },
      })
    ).toMatchObject({
      reason: 'system-operation-not-allowed',
      verdict: 'denied',
    })
  })
})

describe('capability gate', () => {
  it('does not infer an agent capability from Actor type', () => {
    for (const capability of [
      { kind: 'not-required' },
      { capabilityKey: 'graph:write', kind: 'missing' },
    ] as const) {
      expect(evaluatePolicy({ ...baseInput(), capability })).toMatchObject({
        verdict: 'denied',
      })
    }
  })

  it('denies a missing required human capability and accepts an exact grant', () => {
    const shared = {
      ...baseInput(),
      actor: HUMAN_ACTOR,
      authorization: currentMembership('member', 'direct-mutation'),
    }

    expect(
      evaluatePolicy({
        ...shared,
        capability: { capabilityKey: 'intent:refine', kind: 'missing' },
      })
    ).toMatchObject({ reason: 'capability-missing', verdict: 'denied' })
    expect(
      evaluatePolicy({
        ...shared,
        capability: {
          capabilityKey: 'intent:refine',
          kind: 'granted',
        },
      })
    ).toMatchObject({ verdict: 'allowed' })
  })
})

describe('external commitment approval roles', () => {
  it('exhausts every current Member role and commitment class', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      for (const effectClass of COMMITMENT_EFFECTS) {
        const decision = evaluatePolicy({
          ...baseInput(),
          actor: HUMAN_ACTOR,
          authorization: currentMembership(role, 'commitment-approval'),
          capability: { kind: 'not-required' },
          effect: { class: effectClass, phase: 'external-commitment' },
        })
        const mayApprove =
          role === 'owner' ||
          role === 'admin' ||
          (role === 'member' && effectClass !== 'financial')

        expect(decision.verdict).toBe(mayApprove ? 'allowed' : 'denied')
      }
    }
  })

  it('lets a non-viewer propose financial work without treating that as approval', () => {
    const decision = evaluatePolicy({
      ...baseInput(),
      actor: HUMAN_ACTOR,
      authorization: currentMembership('member', 'direct-mutation'),
      capability: { kind: 'not-required' },
      effect: { class: 'financial', phase: 'external-commitment' },
    })

    expect(decision).toMatchObject({
      reason: 'policy-matrix',
      verdict: 'requires-human-approval',
    })
  })

  it('rejects approval mode for a non-commitment effect', () => {
    const decision = evaluatePolicy({
      ...baseInput(),
      actor: HUMAN_ACTOR,
      authorization: currentMembership('owner', 'commitment-approval'),
      capability: { kind: 'not-required' },
    })

    expect(decision).toMatchObject({
      reason: 'actor-authorization-mismatch',
      verdict: 'denied',
    })
  })
})

describe('brand restrictions', () => {
  it('supports every restrict-only verdict on an otherwise allowed effect', () => {
    for (const verdict of [
      'requires-verification',
      'requires-human-approval',
      'denied',
    ] as const) {
      const decision = evaluateAsAgent(GRAPH_INTERNAL, ORIGIN_FREE, [
        { decisionId: `restriction-${verdict}`, verdict },
      ])

      expect(decision.verdict).toBe(verdict)
      expect(decision.reason).toBe('brand-restriction')
    }
  })

  it('cannot lower the external commitment approval floor', () => {
    const decision = evaluateAsAgent(
      { class: 'communication', phase: 'external-commitment' },
      acceptedIntentOrigin('high'),
      [
        {
          decisionId: 'restriction-verify',
          verdict: 'requires-verification',
        },
      ]
    )

    expect(decision.verdict).toBe('requires-human-approval')
  })

  it('uses the strictest restriction and canonicalizes Decision ids', () => {
    const decision = evaluateAsAgent(GRAPH_INTERNAL, ORIGIN_FREE, [
      {
        decisionId: 'restriction-z',
        verdict: 'requires-verification',
      },
      {
        decisionId: 'restriction-a',
        verdict: 'denied',
      },
      {
        decisionId: 'restriction-m',
        verdict: 'requires-human-approval',
      },
    ])

    expect(decision).toMatchObject({
      reason: 'brand-restriction',
      restrictionDecisionIds: [
        'restriction-a',
        'restriction-m',
        'restriction-z',
      ],
      verdict: 'denied',
    })
  })

  it('denies duplicate or unidentifiable restriction facts', () => {
    const invalidSets: readonly ApplicableBrandRestriction[][] = [
      [
        { decisionId: 'restriction-1', verdict: 'requires-verification' },
        { decisionId: 'restriction-1', verdict: 'denied' },
      ],
      [{ decisionId: '', verdict: 'denied' }],
    ]

    for (const currentBrandRestrictions of invalidSets) {
      expect(
        evaluatePolicy({ ...baseInput(), currentBrandRestrictions })
      ).toMatchObject({
        reason: 'invalid-policy-input',
        verdict: 'denied',
      })
    }
  })
})

describe('policy snapshot result', () => {
  it('returns the version, trusted role, derived level, and exact inputs used', () => {
    const decision = evaluatePolicy({
      ...baseInput(),
      actor: HUMAN_ACTOR,
      authorization: currentMembership('admin', 'direct-mutation'),
      capability: { kind: 'not-required' },
      currentBrandRestrictions: [
        {
          decisionId: 'restriction-1',
          verdict: 'requires-verification',
        },
      ],
      origin: acceptedIntentOrigin('high'),
    })

    expect(decision).toEqual({
      memberRole: 'admin',
      policyVersion: POLICY_VERSION,
      reason: 'brand-restriction',
      restrictionDecisionIds: ['restriction-1'],
      selectedPreauthorizations: [
        { authorizedIntentRevision: 3, decisionId: 'decision-1' },
      ],
      structureLevel: 'high',
      verdict: 'requires-verification',
    })
  })

  it('denies an invalid origin before evaluating a permissive matrix cell', () => {
    const decision = evaluatePolicy({
      ...baseInput(),
      origin: {
        intent: currentIntent({ status: 'draft' }),
        kind: 'new-intent-work',
      },
    })

    expect(decision).toMatchObject({
      reason: 'intent-not-active',
      structureLevel: null,
      verdict: 'denied',
    })
  })
})
