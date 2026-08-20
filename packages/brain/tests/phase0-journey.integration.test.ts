import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  type CompleteModelSelection,
  createEveModelConfig,
} from '@repo/agents/model-config'
import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { member, organization, user } from '@repo/db/schema/auth'
import {
  actions,
  actors,
  brands,
  creditLedger,
  intents,
  objects,
  sessionEvents,
  tasks,
} from '@repo/db/schema/domain'
import { executeStatementsSequentially } from '@repo/db/test-support'
import { and, asc, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  findPrimaryInstalledEve,
  importPublicEveModule,
  importSourcePinnedEveModule,
  readRecord,
} from '../../../tests/eve/installed-eve'
import type {
  TrustedCmoTurnAccess,
  TrustedMemberAccess,
  TrustedOrganizationAccess,
  TrustedTaskExecution,
} from '../src/context'
import {
  bindCmoSession,
  createCmoConversation,
  listCmoConversations,
  openCmoConversation,
} from '../src/conversations'
import { declareIntentFromCmo, refineIntentFromCmo } from '../src/intents'
import {
  claimContextBootstrap,
  commitContextBootstrap,
  produceProductMarketerContext,
  recoverContextBootstrapClaim,
} from '../src/objects'
import { createBrandOnboarding } from '../src/onboarding'
import {
  getBrandIntent,
  getBrandObject,
  getBrandProjection,
} from '../src/projections'
import {
  ingestSessionEvent,
  parsePersistableSessionEvent,
  type SessionEventEnvelope,
} from '../src/session-events'
import {
  AGENT_DELIVERY_RECOVERY_WINDOW_MS,
  bindTaskSession,
  claimRegisteredAgentTask,
  failRegisteredAgentDelivery,
  finishTask,
  PRODUCT_MARKETER_TASK_KIND,
  PRODUCT_MARKETER_WORKER_KEY,
  requestSpecialistWork,
} from '../src/tasks'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const POSTGRES_MAJOR_VERSION = '17'
const CONTEXT_SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001'
const CONTEXT_SYSTEM_ACTOR_KEY = 'system:context-dev' as const
const CMO_ACTOR_ID = '00000000-0000-0000-0000-000000000101'
const CMO_ACTOR_KEY = 'agent:cmo' as const
const PRODUCT_MARKETER_ACTOR_ID = '00000000-0000-0000-0000-000000000102'
const PRODUCT_MARKETER_ACTOR_KEY = 'agent:product-marketer' as const
const INITIAL_ARTIFACT_SHA = 'a'.repeat(64)
const RETRY_ARTIFACT_SHA = 'b'.repeat(64)
const MODEL_ID = 'dynamic:deepseek/deepseek-v4-pro-0813'
const MODEL_COST_USD = 0.125
const CMO_MODEL_COST_USD = 0.025
const FALLBACK_MODEL_COST_USD = 0.031_25
const FALLBACK_MODEL_GENERATION_ID = 'generation:fallback-model'
const FALLBACK_MODEL_INPUT_TOKENS = 17
const FALLBACK_MODEL_OUTPUT_TOKENS = 11
const FALLBACK_MODEL_REPLY = 'The deterministic fallback model completed.'
const EXPECTED_EVE_VERSION = '0.31.3'
const TEST_TIMEOUT_MS = 30_000
const schemaName = `brain_phase0_journey_${randomUUID().replaceAll('-', '_')}`

interface OrganizationOwner {
  readonly access: TrustedOrganizationAccess
  readonly organizationId: string
  readonly userId: string
}

interface OrganizationMember {
  readonly actorId: string
  readonly actorKey: string
  readonly role: TrustedMemberAccess['role']
  readonly userId: string
}

interface RequestedProductMarketerWork {
  readonly brandId: string
  readonly taskId: string
}

interface EveFallbackSessionProbe {
  readonly events: readonly SessionEventEnvelope[]
  readonly resolvedModelReferences: readonly Readonly<Record<string, unknown>>[]
  readonly result: Readonly<Record<string, unknown>>
  readonly runtimeIdentity: Readonly<Record<string, unknown>>
  readonly version: string
}

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined
let postgresVersion: string | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The Phase 0 journey database is unavailable')
  }
  return database
}

const requireValue = <Value>(
  value: Value | null | undefined,
  message: string
): Value => {
  if (value === undefined || value === null) {
    throw new Error(message)
  }
  return value
}

const createGatewayCostReportingModel = ({
  baseModel,
  costUsd,
  generationId,
}: {
  readonly baseModel: unknown
  readonly costUsd: number
  readonly generationId: string
}): Readonly<Record<string, unknown>> => {
  const model = readRecord(baseModel, 'Eve mock model')

  return new Proxy(model, {
    get(target, property, receiver): unknown {
      const original: unknown = Reflect.get(target, property, receiver)
      if (property !== 'doStream') {
        return original
      }
      if (typeof original !== 'function') {
        throw new Error('Expected the Eve mock model to support streaming')
      }

      return async (options: unknown): Promise<unknown> => {
        const pendingResult: unknown = Reflect.apply(original, target, [
          options,
        ])
        const result = readRecord(
          await Promise.resolve(pendingResult),
          'Eve mock stream result'
        )
        const { stream } = result
        if (!(stream instanceof ReadableStream)) {
          throw new Error('Expected the Eve mock model to return a stream')
        }

        return {
          ...result,
          stream: stream.pipeThrough(
            new TransformStream<unknown, unknown>({
              transform(chunk, controller): void {
                const part = readRecord(chunk, 'Eve mock stream part')
                if (part.type !== 'finish') {
                  controller.enqueue(chunk)
                  return
                }

                controller.enqueue({
                  ...part,
                  providerMetadata: {
                    gateway: { cost: costUsd, generationId },
                  },
                })
              },
            })
          ),
        }
      }
    },
  })
}

const runEveFallbackSession = async ({
  fallbackModel,
  selection,
  sessionId,
}: {
  readonly fallbackModel: string
  readonly selection: CompleteModelSelection
  readonly sessionId: string
}): Promise<EveFallbackSessionProbe> => {
  const installed = await findPrimaryInstalledEve()
  const [evals, harnessModule, nodeStepModule, protocolModule, sessionModule] =
    await Promise.all([
      importPublicEveModule(installed, 'eve/evals'),
      importSourcePinnedEveModule(installed, './harness/tool-loop.js'),
      importSourcePinnedEveModule(installed, './execution/node-step.js'),
      importSourcePinnedEveModule(installed, './protocol/message.js'),
      importSourcePinnedEveModule(installed, './execution/session.js'),
    ])
  const { mockModel } = evals
  if (typeof mockModel !== 'function') {
    throw new Error('Expected eve/evals to export mockModel')
  }

  const scriptedModel = createGatewayCostReportingModel({
    baseModel: mockModel({
      modelId: selection.model,
      respond: {
        text: FALLBACK_MODEL_REPLY,
        usage: {
          inputTokens: FALLBACK_MODEL_INPUT_TOKENS,
          outputTokens: FALLBACK_MODEL_OUTPUT_TOKENS,
        },
      },
    }),
    costUsd: FALLBACK_MODEL_COST_USD,
    generationId: FALLBACK_MODEL_GENERATION_ID,
  })
  const selectedModelReference = {
    contextWindowTokens: selection.modelContextWindowTokens,
    id: selection.model,
    providerOptions: selection.modelOptions.providerOptions,
    routing: { kind: 'gateway', target: selection.model },
  }

  const { buildRuntimeIdentity } = nodeStepModule
  if (typeof buildRuntimeIdentity !== 'function') {
    throw new Error('Expected the source-pinned Eve runtime identity builder')
  }
  const runtimeIdentity = readRecord(
    buildRuntimeIdentity({
      agent: { config: { name: 'CMO' } },
      turnAgent: {
        dynamicModel: {
          eventNames: ['session.started'],
          logicalPath: 'agent.ts',
          sourceId: 'phase0-fallback-charge-fixture',
          sourceKind: 'module',
        },
        id: 'cmo',
        model: { ...selectedModelReference, id: fallbackModel },
      },
    }),
    'Eve runtime identity'
  )

  const { createSession } = sessionModule
  if (typeof createSession !== 'function') {
    throw new Error('Expected the source-pinned Eve session factory')
  }
  const session: unknown = createSession({
    continuationToken: `continuation:${sessionId}`,
    sessionId,
    turnAgent: {
      id: 'cmo',
      instructions: ['Return the deterministic fixture response.'],
      model: selectedModelReference,
      tools: [],
      workspaceSpec: { rootEntries: [] },
    },
  })

  const { stampMessageStreamEvent } = protocolModule
  if (typeof stampMessageStreamEvent !== 'function') {
    throw new Error('Expected the source-pinned Eve event stamper')
  }
  const events: SessionEventEnvelope[] = []
  const resolvedModelReferences: Readonly<Record<string, unknown>>[] = []

  const { createToolLoopHarness } = harnessModule
  if (typeof createToolLoopHarness !== 'function') {
    throw new Error('Expected the source-pinned Eve tool-loop harness')
  }
  const runStep: unknown = createToolLoopHarness({
    handleEvent: (event: unknown): Promise<void> => {
      events.push(parsePersistableSessionEvent(stampMessageStreamEvent(event)))
      return Promise.resolve()
    },
    mode: 'task',
    resolveModel: (
      reference: unknown
    ): Promise<Readonly<Record<string, unknown>>> => {
      resolvedModelReferences.push(
        readRecord(reference, 'resolved Eve model reference')
      )
      return Promise.resolve(scriptedModel)
    },
    runtimeIdentity,
    tools: new Map(),
  })
  if (typeof runStep !== 'function') {
    throw new Error('Expected the Eve harness factory to return a step')
  }

  const result: unknown = await runStep(session, {
    message: 'Exercise the selected fallback model.',
  })
  return {
    events,
    resolvedModelReferences,
    result: readRecord(result, 'Eve fallback harness result'),
    runtimeIdentity,
    version: installed.version,
  }
}

const requireSingleEveEvent = (
  events: readonly SessionEventEnvelope[],
  type: string
): SessionEventEnvelope => {
  const matches = events.filter((event) => event.type === type)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Eve ${type} event`)
  }
  return requireValue(matches[0], `The Eve ${type} event is unavailable`)
}

const createOrganizationOwner = async (): Promise<OrganizationOwner> => {
  const unique = randomUUID()
  const organizationId = `organization:${unique}`
  const userId = `user:${unique}`
  const currentDatabase = requireDatabase()

  await currentDatabase.insert(user).values({
    email: `${unique}@example.test`,
    id: userId,
    name: 'Phase 0 owner',
  })
  await currentDatabase.insert(organization).values({
    id: organizationId,
    name: 'Phase 0 organization',
    slug: `phase0-${unique}`,
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role: 'owner',
    userId,
  })

  return {
    access: { organizationId, userId },
    organizationId,
    userId,
  }
}

const createOrganizationMember = async ({
  organizationId,
  role,
}: {
  readonly organizationId: string
  readonly role: TrustedMemberAccess['role']
}): Promise<OrganizationMember> => {
  const unique = randomUUID()
  const actorId = randomUUID()
  const userId = `user:${unique}`
  const actorKey = `human:${userId}`
  const currentDatabase = requireDatabase()

  await currentDatabase.insert(user).values({
    email: `${unique}@example.test`,
    id: userId,
    name: 'Phase 0 collaborator',
  })
  await currentDatabase.insert(member).values({
    id: `member:${unique}`,
    organizationId,
    role,
    userId,
  })
  await currentDatabase.insert(actors).values({
    actorKey,
    id: actorId,
    type: 'human',
    userId,
  })

  return { actorId, actorKey, role, userId }
}

const findHumanActor = async (
  userId: string
): Promise<{ readonly actorId: string; readonly actorKey: string }> => {
  const [humanActor] = await requireDatabase()
    .select({ actorId: actors.id, actorKey: actors.actorKey })
    .from(actors)
    .where(and(eq(actors.type, 'human'), eq(actors.userId, userId)))
    .limit(1)

  return requireValue(
    humanActor,
    `The Human Actor for ${userId} was not materialized`
  )
}

const memberAccess = ({
  actorId,
  actorKey,
  brandId,
  organizationId,
  role,
  userId,
}: {
  readonly actorId: string
  readonly actorKey: string
  readonly brandId: string
  readonly organizationId: string
  readonly role: TrustedMemberAccess['role']
  readonly userId: string
}): TrustedMemberAccess => ({
  brandId,
  humanActorId: actorId,
  humanActorKey: actorKey,
  organizationId,
  role,
  userId,
})

const cmoTurnAccess = ({
  access,
  callId,
  conversationId,
  rootSessionId,
  sessionId = rootSessionId,
  turnId,
}: {
  readonly access: TrustedMemberAccess
  readonly callId: string
  readonly conversationId: string
  readonly rootSessionId: string
  readonly sessionId?: string
  readonly turnId: string
}): TrustedCmoTurnAccess => ({
  ...access,
  callId,
  cmoActorId: CMO_ACTOR_ID,
  cmoActorKey: CMO_ACTOR_KEY,
  conversationId,
  rootSessionId,
  sessionId,
  turnId,
})

const countBrandActions = async ({
  brandId,
  type,
}: {
  readonly brandId: string
  readonly type: string
}): Promise<number> => {
  const [result] = await requireDatabase()
    .select({ total: count() })
    .from(actions)
    .where(and(eq(actions.brandId, brandId), eq(actions.type, type)))
  return requireValue(result, 'The Action count query returned no row').total
}

const countBrandObjects = async (brandId: string): Promise<number> => {
  const [result] = await requireDatabase()
    .select({ total: count() })
    .from(objects)
    .where(eq(objects.brandId, brandId))
  return requireValue(result, 'The Object count query returned no row').total
}

const bootstrapContext = async ({
  access,
  websiteUrl,
}: {
  readonly access: TrustedMemberAccess
  readonly websiteUrl: string
}) => {
  const claim = await claimContextBootstrap({
    access,
    database: requireDatabase(),
  })
  if (claim.kind !== 'claimed') {
    throw new Error('The initial Context bootstrap unexpectedly replayed')
  }
  const receipt = await commitContextBootstrap({
    access: {
      brandId: access.brandId,
      systemActorId: CONTEXT_SYSTEM_ACTOR_ID,
      systemActorKey: CONTEXT_SYSTEM_ACTOR_KEY,
    },
    claim,
    database: requireDatabase(),
    input: {
      artifacts: [
        {
          blobKey: `brands/${access.brandId}/artifacts/sha256/${INITIAL_ARTIFACT_SHA}.png`,
          byteSize: 128,
          contentType: 'image/png',
          finalUrl: 'https://assets.example.test/logo-final.png',
          sha256: INITIAL_ARTIFACT_SHA,
          sourceUrl: 'https://assets.example.test/logo-source.png',
        },
      ],
      snapshot: {
        colors: ['#12372a', '#f5f0e8'],
        name: 'Scripted Phase 0 context',
      },
      websiteUrl,
    },
  })
  return { claim, receipt }
}

const createFundedProductMarketerWork = async ({
  label,
  owner,
  ownerActor,
}: {
  readonly label: 'bound' | 'human-head' | 'recovery' | 'turn-failed'
  readonly owner: OrganizationOwner
  readonly ownerActor: {
    readonly actorId: string
    readonly actorKey: string
  }
}): Promise<RequestedProductMarketerWork> => {
  const unique = randomUUID()
  const websiteUrl = `https://d3-${label}-${unique}.example.test`
  const onboarding = await createBrandOnboarding({
    access: owner.access,
    database: requireDatabase(),
    input: {
      brandName: `D3 ${label} brand`,
      brandSlug: `d3-${label}-${unique}`,
      intentStatement: `Exercise the ADR-018 ${label} delivery invariant.`,
      requestId: `onboarding:d3:${label}:${unique}`,
      websiteUrl,
    },
  })
  const access = memberAccess({
    actorId: ownerActor.actorId,
    actorKey: ownerActor.actorKey,
    brandId: onboarding.brandId,
    organizationId: owner.organizationId,
    role: 'owner',
    userId: owner.userId,
  })
  await bootstrapContext({ access, websiteUrl })
  const conversation = await createCmoConversation({
    access,
    database: requireDatabase(),
    input: { title: `ADR-018 ${label} delivery` },
  })
  const rootSessionId = `session:d3:${label}:${randomUUID()}`
  await bindCmoSession({
    access,
    database: requireDatabase(),
    input: {
      conversationId: conversation.id,
      sessionId: rootSessionId,
      source: 'proxy-create-response',
    },
  })
  const work = await requestSpecialistWork({
    access: cmoTurnAccess({
      access,
      callId: `call:d3:${label}:${randomUUID()}`,
      conversationId: conversation.id,
      rootSessionId,
      turnId: `turn:d3:${label}:${randomUUID()}`,
    }),
    database: requireDatabase(),
    input: {
      intentId: onboarding.intentId,
      kind: PRODUCT_MARKETER_TASK_KIND,
      payload: { purpose: 'enrich_brand_context' },
      requestId: `work:d3:${label}:${randomUUID()}`,
    },
  })
  if (work.disposition !== 'created') {
    throw new Error(`The ADR-018 ${label} task setup did not create a task`)
  }
  return { brandId: onboarding.brandId, taskId: work.taskId }
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for Phase 0 integration tests')
  }

  adminPool = createDatabasePool({ connectionString: databaseUrl, max: 1 })
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`)

  const scopedUrl = new URL(databaseUrl)
  scopedUrl.searchParams.set('options', `-c search_path=${schemaName},public`)
  const scopedDatabasePool = createDatabasePool({
    connectionString: scopedUrl.toString(),
    max: 4,
  })
  databasePool = scopedDatabasePool
  database = createDatabase(scopedDatabasePool)

  const migration = await readFile(
    new URL('../../db/drizzle/0000_phase0_foundation.sql', import.meta.url),
    'utf8'
  )
  const statements = migration
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
  await executeStatementsSequentially({
    execute: (statement) => scopedDatabasePool.query(statement),
    statements,
  })

  const versionResult = await scopedDatabasePool.query<{
    readonly server_version: string
  }>('SHOW server_version')
  postgresVersion = requireValue(
    versionResult.rows[0],
    'PostgreSQL did not report its server version'
  ).server_version
})

afterAll(async () => {
  await databasePool?.end()
  if (adminPool !== undefined) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await adminPool.end()
  }
})

describe('Phase 0 canonical journey on PostgreSQL', () => {
  it('charges one Eve fallback model step exactly once across terminal replay', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    expect(postgresVersion?.split('.')[0]).toBe(POSTGRES_MAJOR_VERSION)

    const owner = await createOrganizationOwner()
    const unique = randomUUID()
    const onboarding = await createBrandOnboarding({
      access: owner.access,
      database: requireDatabase(),
      input: {
        brandName: 'Fallback charge brand',
        brandSlug: `fallback-charge-${unique}`,
        intentStatement: 'Prove fallback model charge idempotency.',
        requestId: `onboarding:fallback-charge:${unique}`,
        websiteUrl: `https://fallback-charge-${unique}.example.test`,
      },
    })
    const ownerActor = await findHumanActor(owner.userId)
    const access = memberAccess({
      actorId: ownerActor.actorId,
      actorKey: ownerActor.actorKey,
      brandId: onboarding.brandId,
      organizationId: owner.organizationId,
      role: 'owner',
      userId: owner.userId,
    })
    const conversation = await createCmoConversation({
      access,
      database: requireDatabase(),
      input: { title: 'Fallback model charge evidence' },
    })
    const sessionId = `session:fallback-charge:${randomUUID()}`
    await bindCmoSession({
      access,
      database: requireDatabase(),
      input: {
        conversationId: conversation.id,
        parentSessionId: null,
        sessionId,
        source: 'root-hook',
      },
    })

    const fallbacks: unknown[] = []
    const modelConfig = createEveModelConfig(
      { agentKey: 'cmo', environment: 'test', lane: 'cmo' },
      {
        loadActiveBrandProfileKey: (): Promise<never> =>
          Promise.reject(new Error('deterministic override lookup failure')),
        onFallback: (fallback): void => {
          fallbacks.push(fallback)
        },
      }
    )
    const resolveAtSessionStart = modelConfig.events['session.started']
    if (resolveAtSessionStart === undefined) {
      throw new Error('Expected the session-scoped Eve model resolver')
    }
    const selection = await resolveAtSessionStart(
      {},
      {
        channel: { kind: 'test' },
        messages: [],
        session: {
          auth: {
            current: {
              attributes: { brand_id: onboarding.brandId },
              authenticator: 'phase0-fixture',
              principalId: 'phase0-fixture',
              principalType: 'service',
            },
            initiator: {
              attributes: { brand_id: onboarding.brandId },
              authenticator: 'phase0-fixture',
              principalId: 'phase0-fixture',
              principalType: 'service',
            },
          },
          id: sessionId,
        },
      }
    )
    if (typeof modelConfig.fallback !== 'string') {
      throw new Error('Expected the registered Eve fallback to be a model id')
    }
    expect(fallbacks).toEqual([
      {
        agentKey: 'cmo',
        brandId: onboarding.brandId,
        reason: 'override_lookup_failed',
      },
    ])
    expect(selection).toMatchObject({
      model: modelConfig.fallback,
      modelOptions: {
        providerOptions: {
          gateway: {
            tags: ['agent:cmo', 'env:test', 'feature:conversation', 'lane:cmo'],
            user: onboarding.brandId,
          },
        },
      },
    })

    const eveProbe = await runEveFallbackSession({
      fallbackModel: modelConfig.fallback,
      selection,
      sessionId,
    })
    expect(eveProbe.version).toBe(EXPECTED_EVE_VERSION)
    expect(eveProbe.runtimeIdentity).toMatchObject({
      agentId: 'cmo',
      eveVersion: EXPECTED_EVE_VERSION,
      modelId: `dynamic:${modelConfig.fallback}`,
    })
    expect(eveProbe.resolvedModelReferences).toEqual([
      {
        contextWindowTokens: selection.modelContextWindowTokens,
        id: selection.model,
        providerOptions: selection.modelOptions.providerOptions,
        routing: { kind: 'gateway', target: selection.model },
      },
    ])
    expect(readRecord(eveProbe.result.next, 'Eve fallback result')).toEqual({
      done: true,
      output: FALLBACK_MODEL_REPLY,
    })

    const startedEvent = requireSingleEveEvent(
      eveProbe.events,
      'session.started'
    )
    const stepEvent = requireSingleEveEvent(eveProbe.events, 'step.completed')
    const terminalEvent = requireSingleEveEvent(
      eveProbe.events,
      'session.completed'
    )
    expect(startedEvent).toMatchObject({
      data: {
        runtime: { modelId: `dynamic:${modelConfig.fallback}` },
      },
      type: 'session.started',
    })
    expect(stepEvent).toMatchObject({
      data: {
        providerMetadata: {
          gateway: { generationId: FALLBACK_MODEL_GENERATION_ID },
        },
        usage: {
          costUsd: FALLBACK_MODEL_COST_USD,
          inputTokens: FALLBACK_MODEL_INPUT_TOKENS,
          outputTokens: FALLBACK_MODEL_OUTPUT_TOKENS,
        },
      },
      type: 'step.completed',
    })

    const eventInput = {
      auth: {
        currentBrandId: onboarding.brandId,
        initiatingBrandId: onboarding.brandId,
      },
      owner: {
        conversationId: conversation.id,
        kind: 'conversation' as const,
      },
      session: { kind: 'root' as const, sessionId },
    }
    await ingestSessionEvent({
      database: requireDatabase(),
      input: { ...eventInput, event: startedEvent },
    })
    await ingestSessionEvent({
      database: requireDatabase(),
      input: { ...eventInput, event: stepEvent },
    })
    const stepEventId = stepEvent.meta.id
    const terminalResult = await ingestSessionEvent({
      database: requireDatabase(),
      input: { ...eventInput, event: terminalEvent },
    })
    expect(terminalResult).toMatchObject({
      charges: [{ kind: 'charged', sessionEventId: stepEventId }],
      event: 'inserted',
    })

    const replayedTerminal = await ingestSessionEvent({
      database: requireDatabase(),
      input: { ...eventInput, event: terminalEvent },
    })
    expect(replayedTerminal).toMatchObject({
      charges: [{ kind: 'already_charged', sessionEventId: stepEventId }],
      event: 'replayed',
    })

    const modelCharges = await requireDatabase()
      .select({
        amount: creditLedger.amount,
        gatewayCostUsd: creditLedger.gatewayCostUsd,
        generationId: creditLedger.generationId,
        inputTokens: creditLedger.inputTokens,
        modelId: creditLedger.modelId,
        outputTokens: creditLedger.outputTokens,
        sessionEventId: creditLedger.sessionEventId,
      })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.brandId, onboarding.brandId),
          eq(creditLedger.entryType, 'model_charge'),
          eq(creditLedger.sessionId, sessionId)
        )
      )
    expect(modelCharges).toEqual([
      {
        amount: '-0.031250',
        gatewayCostUsd: '0.03125000',
        generationId: FALLBACK_MODEL_GENERATION_ID,
        inputTokens: FALLBACK_MODEL_INPUT_TOKENS,
        modelId: `dynamic:${modelConfig.fallback}`,
        outputTokens: FALLBACK_MODEL_OUTPUT_TOKENS,
        sessionEventId: stepEventId,
      },
    ])
  })

  it('persists the full local journey with receipts, privacy, provenance, and credit gates', {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    expect(postgresVersion?.split('.')[0]).toBe(POSTGRES_MAJOR_VERSION)

    const owner = await createOrganizationOwner()
    const brandUnique = randomUUID()
    const websiteUrl = `https://phase0-${brandUnique}.example.test`
    const onboarding = await createBrandOnboarding({
      access: owner.access,
      database: requireDatabase(),
      input: {
        brandName: 'Phase 0 Brand',
        brandSlug: `phase0-${brandUnique}`,
        intentStatement: 'Establish the first trustworthy brand context.',
        requestId: `onboarding:${brandUnique}`,
        websiteUrl,
      },
    })
    expect(onboarding).toMatchObject({
      intentRevision: 1,
      outcome: 'brand_created',
    })

    const ownerActor = await findHumanActor(owner.userId)
    const ownerAccess = memberAccess({
      actorId: ownerActor.actorId,
      actorKey: ownerActor.actorKey,
      brandId: onboarding.brandId,
      organizationId: owner.organizationId,
      role: 'owner',
      userId: owner.userId,
    })

    const invalidBootstrapClaim = await claimContextBootstrap({
      access: ownerAccess,
      database: requireDatabase(),
    })
    if (invalidBootstrapClaim.kind !== 'claimed') {
      throw new Error('The invalid Context bootstrap unexpectedly replayed')
    }
    await expect(
      commitContextBootstrap({
        access: {
          brandId: onboarding.brandId,
          systemActorId: CONTEXT_SYSTEM_ACTOR_ID,
          systemActorKey: CONTEXT_SYSTEM_ACTOR_KEY,
        },
        claim: invalidBootstrapClaim,
        database: requireDatabase(),
        input: {
          artifacts: [],
          snapshot: { name: 'Invalid asset-free context' },
          websiteUrl,
        },
      })
    ).rejects.toThrow()
    await recoverContextBootstrapClaim({
      access: {
        brandId: onboarding.brandId,
        systemActorId: CONTEXT_SYSTEM_ACTOR_ID,
        systemActorKey: CONTEXT_SYSTEM_ACTOR_KEY,
      },
      claim: invalidBootstrapClaim,
      database: requireDatabase(),
    })
    const [brandBeforeContextBootstrap] = await requireDatabase()
      .select({ onboardingStatus: brands.onboardingStatus })
      .from(brands)
      .where(eq(brands.id, onboarding.brandId))
      .limit(1)
    expect(brandBeforeContextBootstrap).toEqual({
      onboardingStatus: 'incomplete',
    })
    await expect(countBrandObjects(onboarding.brandId)).resolves.toBe(0)

    const { claim: bootstrapClaim, receipt: bootstrap } =
      await bootstrapContext({
        access: ownerAccess,
        websiteUrl,
      })
    expect(bootstrap.artifactObjectIds).toHaveLength(1)
    expect(bootstrap.outcome).toBe('context_bootstrapped')

    const objectCountBeforeContextRetry = await countBrandObjects(
      onboarding.brandId
    )
    const contextActionCountBeforeRetry = await countBrandActions({
      brandId: onboarding.brandId,
      type: 'context_bootstrapped',
    })
    const replayedBootstrap = await commitContextBootstrap({
      access: {
        brandId: onboarding.brandId,
        systemActorId: CONTEXT_SYSTEM_ACTOR_ID,
        systemActorKey: CONTEXT_SYSTEM_ACTOR_KEY,
      },
      claim: bootstrapClaim,
      database: requireDatabase(),
      input: {
        artifacts: [
          {
            blobKey: `brands/${onboarding.brandId}/artifacts/sha256/${RETRY_ARTIFACT_SHA}.jpg`,
            byteSize: 512,
            contentType: 'image/jpeg',
            finalUrl: 'https://changed.example.test/logo-final.jpg',
            sha256: RETRY_ARTIFACT_SHA,
            sourceUrl: 'https://changed.example.test/logo-source.jpg',
          },
        ],
        snapshot: {
          changedAfterProviderRetry: true,
          name: 'Mutated provider payload that must not fork the graph',
        },
        websiteUrl: `${websiteUrl}/#provider-retry`,
      },
    })
    expect(replayedBootstrap).toEqual(bootstrap)
    expect(await countBrandObjects(onboarding.brandId)).toBe(
      objectCountBeforeContextRetry
    )
    expect(
      await countBrandActions({
        brandId: onboarding.brandId,
        type: 'context_bootstrapped',
      })
    ).toBe(contextActionCountBeforeRetry)

    const collaborator = await createOrganizationMember({
      organizationId: owner.organizationId,
      role: 'member',
    })
    const collaboratorAccess = memberAccess({
      actorId: collaborator.actorId,
      actorKey: collaborator.actorKey,
      brandId: onboarding.brandId,
      organizationId: owner.organizationId,
      role: collaborator.role,
      userId: collaborator.userId,
    })

    const conversation = await createCmoConversation({
      access: ownerAccess,
      database: requireDatabase(),
      input: { title: 'Private Phase 0 CMO thread' },
    })
    const cmoRootSessionId = `session:cmo:${randomUUID()}`
    await bindCmoSession({
      access: ownerAccess,
      database: requireDatabase(),
      input: {
        conversationId: conversation.id,
        parentSessionId: null,
        sessionId: cmoRootSessionId,
        source: 'root-hook',
      },
    })
    const cmoEventAuth = {
      currentBrandId: onboarding.brandId,
      initiatingBrandId: onboarding.brandId,
    }
    const cmoEventOwner = {
      conversationId: conversation.id,
      kind: 'conversation' as const,
    }
    const cmoEventSession = {
      kind: 'root' as const,
      sessionId: cmoRootSessionId,
    }
    const cmoStartedEvent = {
      data: { runtime: { modelId: MODEL_ID } },
      meta: {
        at: '2026-08-17T11:00:00.000Z',
        id: `event:cmo:started:${randomUUID()}`,
      },
      type: 'session.started',
    }
    const cmoStepEvent = {
      data: {
        finishReason: 'tool-calls',
        providerMetadata: {
          gateway: {
            generationId: `generation:cmo:${randomUUID()}`,
            region: 'fra1',
          },
          provider: { requestId: `provider:${randomUUID()}` },
        },
        responseId: `response:${randomUUID()}`,
        sequence: 0,
        stepIndex: 0,
        turnId: `turn:cmo:${randomUUID()}`,
        usage: {
          cacheReadTokens: 2,
          cacheWriteTokens: 0,
          costUsd: CMO_MODEL_COST_USD,
          inputTokens: 200,
          outputTokens: 50,
          totalTokens: 250,
        },
      },
      meta: {
        at: '2026-08-17T11:00:01.000Z',
        id: `event:cmo:step:${randomUUID()}`,
      },
      type: 'step.completed',
    }
    const cmoWaitingEvent = {
      meta: {
        at: '2026-08-17T11:00:02.000Z',
        id: `event:cmo:waiting:${randomUUID()}`,
      },
      type: 'session.waiting',
    }
    await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: cmoEventAuth,
        event: cmoStartedEvent,
        owner: cmoEventOwner,
        session: cmoEventSession,
      },
    })
    await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: cmoEventAuth,
        event: cmoStepEvent,
        owner: cmoEventOwner,
        session: cmoEventSession,
      },
    })
    const cmoWaitingResult = await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: cmoEventAuth,
        event: cmoWaitingEvent,
        owner: cmoEventOwner,
        session: cmoEventSession,
      },
    })
    expect(cmoWaitingResult).toMatchObject({
      charges: [{ kind: 'charged', sessionEventId: cmoStepEvent.meta.id }],
      settlement: { kind: 'not_applicable' },
    })
    const replayedCmoWaiting = await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: cmoEventAuth,
        event: cmoWaitingEvent,
        owner: cmoEventOwner,
        session: cmoEventSession,
      },
    })
    expect(replayedCmoWaiting).toMatchObject({
      charges: [
        { kind: 'already_charged', sessionEventId: cmoStepEvent.meta.id },
      ],
      event: 'replayed',
      settlement: { kind: 'not_applicable' },
    })
    const cmoAccess = cmoTurnAccess({
      access: ownerAccess,
      callId: `call:cmo:${randomUUID()}`,
      conversationId: conversation.id,
      rootSessionId: cmoRootSessionId,
      turnId: `turn:cmo:${randomUUID()}`,
    })

    const declareInput = {
      acceptanceCriteria: [
        { metric: 'positioning is specific to the chosen audience' },
      ],
      constraints: [{ rule: 'do not invent unsupported brand claims' }],
      requestId: `declare:${randomUUID()}`,
      statement: 'Produce an evidence-backed positioning context.',
    }
    const declared = await declareIntentFromCmo({
      access: cmoAccess,
      database: requireDatabase(),
      input: declareInput,
    })
    const declaredReplay = await declareIntentFromCmo({
      access: cmoAccess,
      database: requireDatabase(),
      input: declareInput,
    })
    expect(declaredReplay).toEqual(declared)

    const refineInput = {
      acceptanceCriteria: [
        { metric: 'positioning names audience, need, and evidence' },
      ],
      constraints: [
        { rule: 'retain uncertainty where Context.dev has no evidence' },
      ],
      expectedRevision: 1,
      intentId: declared.intentId,
      requestId: `refine:${randomUUID()}`,
    }
    const refined = await refineIntentFromCmo({
      access: cmoAccess,
      database: requireDatabase(),
      input: refineInput,
    })
    const refinedReplay = await refineIntentFromCmo({
      access: cmoAccess,
      database: requireDatabase(),
      input: refineInput,
    })
    expect(refinedReplay).toEqual(refined)
    expect(refined.intentRevision).toBe(2)

    const workRequestId = `work:${randomUUID()}`
    const workRequest = await requestSpecialistWork({
      access: cmoAccess,
      database: requireDatabase(),
      input: {
        intentId: declared.intentId,
        kind: PRODUCT_MARKETER_TASK_KIND,
        payload: { purpose: 'enrich_brand_context' },
        requestId: workRequestId,
      },
    })
    if (workRequest.disposition !== 'created') {
      throw new Error('The first Product Marketer request was not created')
    }
    const workRequestReplay = await requestSpecialistWork({
      access: cmoAccess,
      database: requireDatabase(),
      input: {
        intentId: declared.intentId,
        kind: PRODUCT_MARKETER_TASK_KIND,
        payload: { purpose: 'enrich_brand_context' },
        requestId: workRequestId,
      },
    })
    expect(workRequestReplay).toEqual(workRequest)

    const specialistActionCountBeforeObserve = await countBrandActions({
      brandId: onboarding.brandId,
      type: 'specialist_work_requested',
    })
    const observedWork = await requestSpecialistWork({
      access: {
        ...cmoAccess,
        callId: `call:cmo:${randomUUID()}`,
        turnId: `turn:cmo:${randomUUID()}`,
      },
      database: requireDatabase(),
      input: {
        intentId: declared.intentId,
        kind: PRODUCT_MARKETER_TASK_KIND,
        payload: { purpose: 'enrich_brand_context' },
        requestId: `observe:${randomUUID()}`,
      },
    })
    expect(observedWork).toEqual({
      disposition: 'already_active',
      intentId: declared.intentId,
      intentRevision: 2,
      outcome: 'specialist_work_observed',
      taskId: workRequest.taskId,
    })
    expect(
      await countBrandActions({
        brandId: onboarding.brandId,
        type: 'specialist_work_requested',
      })
    ).toBe(specialistActionCountBeforeObserve)

    const [queuedTask] = await requireDatabase()
      .select({ revision: tasks.revision, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, workRequest.taskId))
      .limit(1)
    expect(queuedTask).toEqual({ revision: 1, status: 'queued' })

    const claimed = await claimRegisteredAgentTask({
      database: requireDatabase(),
      kind: PRODUCT_MARKETER_TASK_KIND,
      now: new Date(Date.now() + 1000),
    })
    expect(claimed).toMatchObject({
      brandId: onboarding.brandId,
      claimContext: {
        brandContextObjectId: bootstrap.brandContextObjectId,
      },
      taskId: workRequest.taskId,
    })
    const claimedTask = requireValue(
      claimed,
      'The funded Product Marketer task was not claimable'
    )
    const [runningTask] = await requireDatabase()
      .select({ revision: tasks.revision, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, workRequest.taskId))
      .limit(1)
    expect(runningTask).toEqual({ revision: 1, status: 'running' })

    const taskSessionId = `session:product-marketer:${randomUUID()}`
    const execution: TrustedTaskExecution = {
      agentActorId: PRODUCT_MARKETER_ACTOR_ID,
      agentActorKey: PRODUCT_MARKETER_ACTOR_KEY,
      brandId: onboarding.brandId,
      rootSessionId: taskSessionId,
      sessionId: taskSessionId,
      startedAt: claimedTask.startedAt,
      taskId: claimedTask.taskId,
      workerKey: PRODUCT_MARKETER_WORKER_KEY,
    }
    await expect(
      failRegisteredAgentDelivery({
        claim: {
          agentActorId: CMO_ACTOR_ID,
          agentActorKey: CMO_ACTOR_KEY,
          brandId: claimedTask.brandId,
          kind: claimedTask.kind,
          startedAt: claimedTask.startedAt,
          taskId: claimedTask.taskId,
          workerKey: claimedTask.workerKey,
        },
        database: requireDatabase(),
        now: new Date(Date.now() + 1500),
      })
    ).rejects.toMatchObject({ code: 'invalid_task' })
    await expect(
      bindTaskSession({
        database: requireDatabase(),
        execution: {
          ...execution,
          agentActorId: CMO_ACTOR_ID,
          agentActorKey: CMO_ACTOR_KEY,
        },
      })
    ).rejects.toMatchObject({ code: 'invalid_task' })
    await bindTaskSession({ database: requireDatabase(), execution })
    await expect(
      finishTask({
        completion: {
          intentAcceptance: null,
          openQuestions: ['Which Agent owns this task?'],
          outputObjectIds: [],
          result: {
            outcome: 'needs_input',
            reason: 'missing_human_context',
          },
          status: 'blocked',
          summary: 'A different registered Agent attempted completion.',
        },
        database: requireDatabase(),
        execution: {
          ...execution,
          agentActorId: CMO_ACTOR_ID,
          agentActorKey: CMO_ACTOR_KEY,
        },
      })
    ).rejects.toMatchObject({ code: 'invalid_task' })
    const productMarketerChildSessionId = `session:product-marketer-child:${randomUUID()}`
    const childExecution: TrustedTaskExecution = {
      ...execution,
      sessionId: productMarketerChildSessionId,
    }

    const productMarketerOutput = await produceProductMarketerContext({
      content: {
        audiences: [
          {
            need: 'Turn mixed source material into one canonical brief.',
            segment: 'Small product teams',
          },
        ],
        category: 'AI-assisted brand operations',
        differentiators: [
          'Every canonical output retains Action and Actor provenance.',
        ],
        risks: ['Source evidence may be incomplete.'],
        summary: 'A precise operational context grounded in imported evidence.',
        valueProposition:
          'Give a product team a reusable brand context without hiding uncertainty.',
      },
      database: requireDatabase(),
      execution: childExecution,
      expectedBrandContextObjectId:
        claimedTask.claimContext.brandContextObjectId,
      requestId: `output:${randomUUID()}`,
    })
    expect(productMarketerOutput).toMatchObject({
      outcome: 'brand_context_enriched',
      supersededObjectId: bootstrap.brandContextObjectId,
      taskId: claimedTask.taskId,
    })
    const [childOutputAction] = await requireDatabase()
      .select({ sessionId: actions.sessionId })
      .from(actions)
      .where(eq(actions.id, productMarketerOutput.actionId))
      .limit(1)
    expect(childOutputAction).toEqual({
      sessionId: productMarketerChildSessionId,
    })

    await expect(
      finishTask({
        completion: {
          intentAcceptance: null,
          openQuestions: [],
          outputObjectIds: [productMarketerOutput.brandContextObjectId],
          result: {
            brandContextObjectId: productMarketerOutput.brandContextObjectId,
            outcome: 'report',
          },
          status: 'completed',
          summary: 'The canonical Brand Context was enriched.',
        },
        database: requireDatabase(),
        execution,
      })
    ).resolves.toMatchObject({ outcome: 'completion_staged' })

    const eventBaseTime = new Date('2026-08-17T12:00:00.000Z')
    const eventAuth = {
      currentBrandId: onboarding.brandId,
      initiatingBrandId: onboarding.brandId,
    }
    const eventOwner = {
      kind: 'task' as const,
      startedAt: claimedTask.startedAt,
      taskId: workRequest.taskId,
    }
    const eventSession = {
      kind: 'root' as const,
      sessionId: taskSessionId,
    }
    const startedEvent = {
      data: { runtime: { modelId: MODEL_ID } },
      meta: {
        at: eventBaseTime.toISOString(),
        id: `event:started:${randomUUID()}`,
      },
      type: 'session.started',
    }
    const stepEvent = {
      data: {
        finishReason: 'stop',
        providerMetadata: {
          gateway: { generationId: `generation:${randomUUID()}` },
        },
        sequence: 0,
        stepIndex: 0,
        turnId: `turn:product-marketer:${randomUUID()}`,
        usage: {
          cacheReadTokens: 10,
          cacheWriteTokens: 0,
          costUsd: MODEL_COST_USD,
          inputTokens: 800,
          outputTokens: 200,
        },
      },
      meta: {
        at: new Date(eventBaseTime.getTime() + 1000).toISOString(),
        id: `event:step:${randomUUID()}`,
      },
      type: 'step.completed',
    }
    const terminalEvent = {
      meta: {
        at: new Date(eventBaseTime.getTime() + 2000).toISOString(),
        id: `event:completed:${randomUUID()}`,
      },
      type: 'session.completed',
    }

    await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: eventAuth,
        event: startedEvent,
        owner: eventOwner,
        session: eventSession,
      },
    })
    await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: eventAuth,
        event: stepEvent,
        owner: eventOwner,
        session: eventSession,
      },
    })
    const terminalResult = await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: eventAuth,
        event: terminalEvent,
        owner: eventOwner,
        session: eventSession,
      },
    })
    expect(terminalResult).toMatchObject({
      charges: [{ kind: 'charged', sessionEventId: stepEvent.meta.id }],
      event: 'inserted',
      settlement: { kind: 'succeeded', taskId: workRequest.taskId },
    })

    const replayedTerminal = await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: eventAuth,
        event: terminalEvent,
        owner: eventOwner,
        session: eventSession,
      },
    })
    expect(replayedTerminal).toMatchObject({
      charges: [{ kind: 'already_charged', sessionEventId: stepEvent.meta.id }],
      event: 'replayed',
      settlement: {
        kind: 'already_terminal',
        status: 'succeeded',
        taskId: workRequest.taskId,
      },
    })

    const brandProjection = await getBrandProjection({
      access: ownerAccess,
      database: requireDatabase(),
    })
    expect(brandProjection).toMatchObject({
      id: onboarding.brandId,
      memberRole: 'owner',
      onboardingStatus: 'ready',
    })
    const refinedIntentProjection = await getBrandIntent({
      access: ownerAccess,
      database: requireDatabase(),
      input: { intentId: declared.intentId },
    })
    expect(refinedIntentProjection).toMatchObject({
      author: {
        actorKey: ownerActor.actorKey,
        id: ownerActor.actorId,
        type: 'human',
      },
      revision: 2,
      statement: declareInput.statement,
    })

    const enrichedObject = await getBrandObject({
      access: ownerAccess,
      database: requireDatabase(),
      input: { objectId: productMarketerOutput.brandContextObjectId },
    })
    expect(enrichedObject).toMatchObject({
      brandId: onboarding.brandId,
      content: {
        basisObjectId: bootstrap.brandContextObjectId,
        source: 'product-marketer',
        taskId: workRequest.taskId,
      },
      producedBy: {
        actor: {
          actorKey: PRODUCT_MARKETER_ACTOR_KEY,
          id: PRODUCT_MARKETER_ACTOR_ID,
          type: 'agent',
        },
        effectClass: 'graph-internal',
        id: productMarketerOutput.actionId,
        intentId: declared.intentId,
        taskId: workRequest.taskId,
        type: 'brand_context_enriched',
      },
      singletonKey: 'brand-context',
      status: 'active',
      type: 'brand_context',
    })
    const supersededBootstrapObject = await getBrandObject({
      access: ownerAccess,
      database: requireDatabase(),
      input: { objectId: bootstrap.brandContextObjectId },
    })
    expect(supersededBootstrapObject).toMatchObject({
      producedBy: {
        actor: {
          actorKey: CONTEXT_SYSTEM_ACTOR_KEY,
          id: CONTEXT_SYSTEM_ACTOR_ID,
          type: 'system',
        },
        id: bootstrap.actionId,
        type: 'context_bootstrapped',
      },
      status: 'superseded',
      supersededBy: productMarketerOutput.brandContextObjectId,
    })
    const artifactObject = await getBrandObject({
      access: ownerAccess,
      database: requireDatabase(),
      input: {
        objectId: requireValue(
          bootstrap.artifactObjectIds[0],
          'The Context bootstrap returned no Artifact Object id'
        ),
      },
    })
    expect(artifactObject).toMatchObject({
      binary: {
        byteSize: 128,
        contentType: 'image/png',
        kind: 'artifact',
        sha256: INITIAL_ARTIFACT_SHA,
      },
      producedBy: { id: bootstrap.actionId },
      type: 'artifact',
    })

    await expect(
      getBrandObject({
        access: collaboratorAccess,
        database: requireDatabase(),
        input: { objectId: productMarketerOutput.brandContextObjectId },
      })
    ).resolves.toMatchObject({
      producedBy: { id: productMarketerOutput.actionId },
    })
    await expect(
      listCmoConversations({
        access: collaboratorAccess,
        database: requireDatabase(),
        input: {},
      })
    ).resolves.toMatchObject({ items: [] })
    await expect(
      openCmoConversation({
        access: collaboratorAccess,
        database: requireDatabase(),
        input: { conversationId: conversation.id },
      })
    ).rejects.toMatchObject({ code: 'conversation_not_found' })

    const otherTenant = await createOrganizationOwner()
    const otherTenantActor = await createOrganizationMember({
      organizationId: otherTenant.organizationId,
      role: 'owner',
    })
    const forgedCrossTenantAccess = memberAccess({
      actorId: otherTenantActor.actorId,
      actorKey: otherTenantActor.actorKey,
      brandId: onboarding.brandId,
      organizationId: otherTenant.organizationId,
      role: otherTenantActor.role,
      userId: otherTenantActor.userId,
    })
    await expect(
      getBrandObject({
        access: forgedCrossTenantAccess,
        database: requireDatabase(),
        input: { objectId: productMarketerOutput.brandContextObjectId },
      })
    ).rejects.toMatchObject({ code: 'access_denied' })

    const [settledTask] = await requireDatabase()
      .select({
        outcomeCode: tasks.outcomeCode,
        revision: tasks.revision,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, workRequest.taskId))
      .limit(1)
    expect(settledTask).toEqual({
      outcomeCode: 'completed',
      revision: 1,
      status: 'succeeded',
    })
    const ledger = await requireDatabase()
      .select({
        amount: creditLedger.amount,
        entryType: creditLedger.entryType,
        generationId: creditLedger.generationId,
        sessionEventId: creditLedger.sessionEventId,
      })
      .from(creditLedger)
      .where(eq(creditLedger.brandId, onboarding.brandId))
      .orderBy(asc(creditLedger.createdAt), asc(creditLedger.id))
    expect(ledger).toHaveLength(3)
    expect(ledger).toEqual(
      expect.arrayContaining([
        {
          amount: '5.000000',
          entryType: 'grant',
          generationId: null,
          sessionEventId: null,
        },
        {
          amount: '-0.025000',
          entryType: 'model_charge',
          generationId: cmoStepEvent.data.providerMetadata.gateway.generationId,
          sessionEventId: cmoStepEvent.meta.id,
        },
        {
          amount: '-0.125000',
          entryType: 'model_charge',
          generationId: stepEvent.data.providerMetadata.gateway.generationId,
          sessionEventId: stepEvent.meta.id,
        },
      ])
    )
    const [eventCount] = await requireDatabase()
      .select({ total: count() })
      .from(sessionEvents)
      .where(eq(sessionEvents.taskId, workRequest.taskId))
    expect(eventCount?.total).toBe(3)

    const zeroCreditBrandId = randomUUID()
    const zeroCreditIntentId = randomUUID()
    const zeroCreditWebsiteUrl = `https://zero-${randomUUID()}.example.test`
    await requireDatabase()
      .insert(brands)
      .values({
        id: zeroCreditBrandId,
        name: 'Zero Credit Brand',
        onboardingStatus: 'incomplete',
        organizationId: owner.organizationId,
        slug: `zero-credit-${randomUUID()}`,
        websiteUrl: zeroCreditWebsiteUrl,
      })
    await requireDatabase()
      .insert(intents)
      .values({
        acceptanceCriteria: [{ metric: 'one grounded positioning report' }],
        authorActorId: ownerActor.actorId,
        brandId: zeroCreditBrandId,
        id: zeroCreditIntentId,
        parentIntentId: null,
        revision: 1,
        statement: 'Attempt specialist work without an alpha grant.',
        status: 'active',
      })
    const zeroCreditOwnerAccess = memberAccess({
      actorId: ownerActor.actorId,
      actorKey: ownerActor.actorKey,
      brandId: zeroCreditBrandId,
      organizationId: owner.organizationId,
      role: 'owner',
      userId: owner.userId,
    })
    const { receipt: zeroCreditContext } = await bootstrapContext({
      access: zeroCreditOwnerAccess,
      websiteUrl: zeroCreditWebsiteUrl,
    })
    expect(zeroCreditContext.outcome).toBe('context_bootstrapped')
    const zeroCreditConversation = await createCmoConversation({
      access: zeroCreditOwnerAccess,
      database: requireDatabase(),
      input: { title: 'Zero credit gate' },
    })
    const zeroCreditSessionId = `session:zero:${randomUUID()}`
    await bindCmoSession({
      access: zeroCreditOwnerAccess,
      database: requireDatabase(),
      input: {
        conversationId: zeroCreditConversation.id,
        sessionId: zeroCreditSessionId,
        source: 'proxy-create-response',
      },
    })
    const zeroCreditWork = await requestSpecialistWork({
      access: cmoTurnAccess({
        access: zeroCreditOwnerAccess,
        callId: `call:zero:${randomUUID()}`,
        conversationId: zeroCreditConversation.id,
        rootSessionId: zeroCreditSessionId,
        turnId: `turn:zero:${randomUUID()}`,
      }),
      database: requireDatabase(),
      input: {
        intentId: zeroCreditIntentId,
        kind: PRODUCT_MARKETER_TASK_KIND,
        payload: { purpose: 'enrich_brand_context' },
        requestId: `work:zero:${randomUUID()}`,
      },
    })
    if (zeroCreditWork.disposition !== 'created') {
      throw new Error('The zero-credit task setup did not create a task')
    }
    await expect(
      claimRegisteredAgentTask({
        database: requireDatabase(),
        kind: PRODUCT_MARKETER_TASK_KIND,
        now: new Date(Date.now() + 2000),
      })
    ).resolves.toBeNull()
    const [zeroCreditTask] = await requireDatabase()
      .select({ revision: tasks.revision, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, zeroCreditWork.taskId))
      .limit(1)
    expect(zeroCreditTask).toEqual({ revision: 1, status: 'queued' })
    const [zeroCreditLedgerCount] = await requireDatabase()
      .select({ total: count() })
      .from(creditLedger)
      .where(eq(creditLedger.brandId, zeroCreditBrandId))
    expect(zeroCreditLedgerCount?.total).toBe(0)

    const recoveryWork = await createFundedProductMarketerWork({
      label: 'recovery',
      owner,
      ownerActor,
    })
    const recoveryNow = new Date(
      Date.now() + AGENT_DELIVERY_RECOVERY_WINDOW_MS + 10_000
    )
    const staleStartedAt = new Date(
      recoveryNow.getTime() - AGENT_DELIVERY_RECOVERY_WINDOW_MS - 1
    )
    const firstRecoveryClaim = await claimRegisteredAgentTask({
      database: requireDatabase(),
      kind: PRODUCT_MARKETER_TASK_KIND,
      now: staleStartedAt,
    })
    expect(firstRecoveryClaim?.taskId).toBe(recoveryWork.taskId)
    const staleTaskClaim = requireValue(
      firstRecoveryClaim,
      'The first recovery task claim was not created'
    )
    expect(staleTaskClaim.startedAt).toEqual(staleStartedAt)
    await requireDatabase()
      .update(tasks)
      .set({ startedAt: staleStartedAt })
      .where(eq(tasks.id, recoveryWork.taskId))

    const recoveredClaim = await claimRegisteredAgentTask({
      database: requireDatabase(),
      kind: PRODUCT_MARKETER_TASK_KIND,
      now: recoveryNow,
    })
    expect(recoveredClaim).toMatchObject({
      brandId: recoveryWork.brandId,
      taskId: recoveryWork.taskId,
    })
    const recoveredTaskClaim = requireValue(
      recoveredClaim,
      'The stale unbound Product Marketer task was not recovered'
    )
    expect(recoveredTaskClaim.startedAt).toEqual(recoveryNow)
    expect(recoveredTaskClaim.startedAt).not.toEqual(staleTaskClaim.startedAt)
    const [recoveredTask] = await requireDatabase()
      .select({
        revision: tasks.revision,
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, recoveryWork.taskId))
      .limit(1)
    expect(recoveredTask).toEqual({
      revision: 1,
      sessionId: null,
      startedAt: recoveryNow,
      status: 'running',
    })

    await expect(
      failRegisteredAgentDelivery({
        claim: staleTaskClaim,
        database: requireDatabase(),
        now: new Date(recoveryNow.getTime() + 250),
      })
    ).resolves.toEqual({
      outcome: 'not_unbound_running',
      taskId: recoveryWork.taskId,
    })

    const staleTaskSessionId = `session:d3:stale:${randomUUID()}`
    await expect(
      bindTaskSession({
        database: requireDatabase(),
        execution: {
          agentActorId: staleTaskClaim.agentActorId,
          agentActorKey: staleTaskClaim.agentActorKey,
          brandId: staleTaskClaim.brandId,
          rootSessionId: staleTaskSessionId,
          sessionId: staleTaskSessionId,
          startedAt: staleTaskClaim.startedAt,
          taskId: staleTaskClaim.taskId,
          workerKey: staleTaskClaim.workerKey,
        },
      })
    ).rejects.toMatchObject({ code: 'already_claimed' })

    await expect(
      ingestSessionEvent({
        database: requireDatabase(),
        input: {
          auth: {
            currentBrandId: recoveryWork.brandId,
            initiatingBrandId: recoveryWork.brandId,
          },
          event: {
            meta: {
              at: new Date(recoveryNow.getTime() + 500).toISOString(),
              id: `event:d3:stale:${randomUUID()}`,
            },
            type: 'session.failed',
          },
          owner: {
            kind: 'task',
            startedAt: staleTaskClaim.startedAt,
            taskId: staleTaskClaim.taskId,
          },
          session: { kind: 'root', sessionId: staleTaskSessionId },
        },
      })
    ).rejects.toMatchObject({ code: 'invalid_event' })

    const [taskAfterStaleAttempts] = await requireDatabase()
      .select({
        completion: tasks.completion,
        sessionId: tasks.sessionId,
        startedAt: tasks.startedAt,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, recoveryWork.taskId))
      .limit(1)
    expect(taskAfterStaleAttempts).toEqual({
      completion: null,
      sessionId: null,
      startedAt: recoveryNow,
      status: 'running',
    })

    const deliveryFailureTime = new Date(recoveryNow.getTime() + 1000)
    await expect(
      failRegisteredAgentDelivery({
        claim: recoveredTaskClaim,
        database: requireDatabase(),
        now: deliveryFailureTime,
      })
    ).resolves.toEqual({
      outcome: 'delivery_failed',
      taskId: recoveryWork.taskId,
    })
    const [deliveryFailedTask] = await requireDatabase()
      .select({
        finishedAt: tasks.finishedAt,
        outcomeCode: tasks.outcomeCode,
        revision: tasks.revision,
        sessionId: tasks.sessionId,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, recoveryWork.taskId))
      .limit(1)
    expect(deliveryFailedTask).toEqual({
      finishedAt: deliveryFailureTime,
      outcomeCode: 'DELIVERY_FAILED',
      revision: 1,
      sessionId: null,
      status: 'failed',
    })

    const boundWork = await createFundedProductMarketerWork({
      label: 'bound',
      owner,
      ownerActor,
    })
    const boundClaim = await claimRegisteredAgentTask({
      database: requireDatabase(),
      kind: PRODUCT_MARKETER_TASK_KIND,
      now: new Date(deliveryFailureTime.getTime() + 1000),
    })
    expect(boundClaim?.taskId).toBe(boundWork.taskId)
    const claimedBoundTask = requireValue(
      boundClaim,
      'The bound-delivery setup task was not claimed'
    )
    const boundTaskSessionId = `session:d3:bound-task:${randomUUID()}`
    const boundExecution: TrustedTaskExecution = {
      agentActorId: claimedBoundTask.agentActorId,
      agentActorKey: claimedBoundTask.agentActorKey,
      brandId: claimedBoundTask.brandId,
      rootSessionId: boundTaskSessionId,
      sessionId: boundTaskSessionId,
      startedAt: claimedBoundTask.startedAt,
      taskId: claimedBoundTask.taskId,
      workerKey: claimedBoundTask.workerKey,
    }
    await bindTaskSession({
      database: requireDatabase(),
      execution: boundExecution,
    })
    const staleBoundExecution: TrustedTaskExecution = {
      ...boundExecution,
      startedAt: new Date(boundExecution.startedAt.getTime() - 1),
    }
    await expect(
      produceProductMarketerContext({
        content: {
          audiences: [{ need: 'Prove the claim fence.', segment: 'Teams' }],
          category: 'Claim-fenced marketing operations',
          differentiators: ['Persisted execution generation'],
          risks: [],
          summary: 'This stale execution must not write canonical state.',
          valueProposition: 'Reject work from an obsolete claim generation.',
        },
        database: requireDatabase(),
        execution: staleBoundExecution,
        expectedBrandContextObjectId:
          claimedBoundTask.claimContext.brandContextObjectId,
        requestId: `output:d3:stale:${randomUUID()}`,
      })
    ).rejects.toMatchObject({ code: 'invalid_task' })
    await expect(
      finishTask({
        completion: {
          intentAcceptance: null,
          openQuestions: ['Which claim generation is authoritative?'],
          outputObjectIds: [],
          result: {
            outcome: 'needs_input',
            reason: 'missing_human_context',
          },
          status: 'blocked',
          summary: 'A stale execution attempted to stage completion.',
        },
        database: requireDatabase(),
        execution: staleBoundExecution,
      })
    ).rejects.toMatchObject({ code: 'invalid_task' })
    const [boundTaskBeforeFailure] = await requireDatabase()
      .select({
        finishedAt: tasks.finishedAt,
        outcomeCode: tasks.outcomeCode,
        revision: tasks.revision,
        sessionId: tasks.sessionId,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, boundWork.taskId))
      .limit(1)
    await expect(
      failRegisteredAgentDelivery({
        claim: claimedBoundTask,
        database: requireDatabase(),
        now: new Date(deliveryFailureTime.getTime() + 2000),
      })
    ).resolves.toEqual({
      outcome: 'not_unbound_running',
      taskId: boundWork.taskId,
    })
    const [boundTaskAfterFailure] = await requireDatabase()
      .select({
        finishedAt: tasks.finishedAt,
        outcomeCode: tasks.outcomeCode,
        revision: tasks.revision,
        sessionId: tasks.sessionId,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, boundWork.taskId))
      .limit(1)
    expect(boundTaskBeforeFailure).toEqual({
      finishedAt: null,
      outcomeCode: null,
      revision: 1,
      sessionId: boundTaskSessionId,
      status: 'running',
    })
    expect(boundTaskAfterFailure).toEqual(boundTaskBeforeFailure)

    const cancellationTime = new Date(deliveryFailureTime.getTime() + 3000)
    const cancellationResult = await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: {
          currentBrandId: claimedBoundTask.brandId,
          initiatingBrandId: claimedBoundTask.brandId,
        },
        event: {
          meta: {
            at: cancellationTime.toISOString(),
            id: `event:turn-cancelled:${randomUUID()}`,
          },
          type: 'turn.cancelled',
        },
        owner: {
          kind: 'task',
          startedAt: claimedBoundTask.startedAt,
          taskId: claimedBoundTask.taskId,
        },
        session: { kind: 'root', sessionId: boundTaskSessionId },
      },
    })
    expect(cancellationResult.settlement).toEqual({
      kind: 'cancelled',
      reason: 'turn_cancelled',
      taskId: claimedBoundTask.taskId,
    })
    const [cancelledTask] = await requireDatabase()
      .select({
        completion: tasks.completion,
        finishedAt: tasks.finishedAt,
        outcomeCode: tasks.outcomeCode,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, claimedBoundTask.taskId))
      .limit(1)
    expect(cancelledTask).toEqual({
      completion: null,
      finishedAt: cancellationTime,
      outcomeCode: 'TURN_CANCELLED',
      status: 'cancelled',
    })

    const failedWork = await createFundedProductMarketerWork({
      label: 'turn-failed',
      owner,
      ownerActor,
    })
    const failedClaim = requireValue(
      await claimRegisteredAgentTask({
        database: requireDatabase(),
        kind: PRODUCT_MARKETER_TASK_KIND,
        now: new Date(cancellationTime.getTime() + 1000),
      }),
      'The turn-failure setup task was not claimed'
    )
    expect(failedClaim.taskId).toBe(failedWork.taskId)
    const failedSessionId = `session:turn-failed:${randomUUID()}`
    await bindTaskSession({
      database: requireDatabase(),
      execution: {
        agentActorId: failedClaim.agentActorId,
        agentActorKey: failedClaim.agentActorKey,
        brandId: failedClaim.brandId,
        rootSessionId: failedSessionId,
        sessionId: failedSessionId,
        startedAt: failedClaim.startedAt,
        taskId: failedClaim.taskId,
        workerKey: failedClaim.workerKey,
      },
    })
    const turnFailureTime = new Date(cancellationTime.getTime() + 2000)
    const turnFailureResult = await ingestSessionEvent({
      database: requireDatabase(),
      input: {
        auth: {
          currentBrandId: failedClaim.brandId,
          initiatingBrandId: failedClaim.brandId,
        },
        event: {
          meta: {
            at: turnFailureTime.toISOString(),
            id: `event:turn-failed:${randomUUID()}`,
          },
          type: 'turn.failed',
        },
        owner: {
          kind: 'task',
          startedAt: failedClaim.startedAt,
          taskId: failedClaim.taskId,
        },
        session: { kind: 'root', sessionId: failedSessionId },
      },
    })
    expect(turnFailureResult.settlement).toEqual({
      kind: 'failed',
      reason: 'turn_failed',
      taskId: failedClaim.taskId,
    })
    const [turnFailedTask] = await requireDatabase()
      .select({
        completion: tasks.completion,
        finishedAt: tasks.finishedAt,
        outcomeCode: tasks.outcomeCode,
        status: tasks.status,
      })
      .from(tasks)
      .where(eq(tasks.id, failedClaim.taskId))
      .limit(1)
    expect(turnFailedTask).toEqual({
      completion: null,
      finishedAt: turnFailureTime,
      outcomeCode: 'TURN_FAILED',
      status: 'failed',
    })

    const humanHeadWork = await createFundedProductMarketerWork({
      label: 'human-head',
      owner,
      ownerActor,
    })
    const [systemContextHead] = await requireDatabase()
      .select({ id: objects.id })
      .from(objects)
      .where(
        and(
          eq(objects.brandId, humanHeadWork.brandId),
          eq(objects.singletonKey, 'brand-context'),
          eq(objects.status, 'active')
        )
      )
      .limit(1)
    const currentSystemContext = requireValue(
      systemContextHead,
      'The human-head guard setup has no system Brand Context'
    )
    const humanContextActionId = randomUUID()
    const humanContextObjectId = randomUUID()
    const humanContextContent = {
      name: 'Human-edited Brand Context',
      source: 'human',
    }
    await requireDatabase().transaction(async (transaction) => {
      await transaction.insert(actions).values({
        actorId: ownerActor.actorId,
        brandId: humanHeadWork.brandId,
        effectClass: 'graph-internal',
        id: humanContextActionId,
        payload: { objectId: humanContextObjectId },
        policySnapshot: { authorization: 'human-direct-mutation' },
        rationale: 'A human deliberately edited the canonical Brand Context',
        type: 'brand_context_edited',
      })
      await transaction
        .update(objects)
        .set({
          status: 'superseded',
          supersededAt: turnFailureTime,
          supersededBy: humanContextObjectId,
        })
        .where(eq(objects.id, currentSystemContext.id))
      await transaction.insert(objects).values({
        brandId: humanHeadWork.brandId,
        content: humanContextContent,
        contentText: JSON.stringify(humanContextContent),
        id: humanContextObjectId,
        producedBy: humanContextActionId,
        singletonKey: 'brand-context',
        status: 'active',
        type: 'brand_context',
      })
    })

    const humanHeadClaim = requireValue(
      await claimRegisteredAgentTask({
        database: requireDatabase(),
        kind: PRODUCT_MARKETER_TASK_KIND,
        now: new Date(turnFailureTime.getTime() + 1000),
      }),
      'The human-head guard setup task was not claimed'
    )
    expect(humanHeadClaim).toMatchObject({
      claimContext: { brandContextObjectId: humanContextObjectId },
      taskId: humanHeadWork.taskId,
    })
    const humanHeadSessionId = `session:human-head:${randomUUID()}`
    const humanHeadExecution: TrustedTaskExecution = {
      agentActorId: humanHeadClaim.agentActorId,
      agentActorKey: humanHeadClaim.agentActorKey,
      brandId: humanHeadClaim.brandId,
      rootSessionId: humanHeadSessionId,
      sessionId: humanHeadSessionId,
      startedAt: humanHeadClaim.startedAt,
      taskId: humanHeadClaim.taskId,
      workerKey: humanHeadClaim.workerKey,
    }
    await bindTaskSession({
      database: requireDatabase(),
      execution: humanHeadExecution,
    })
    await expect(
      produceProductMarketerContext({
        content: {
          audiences: [{ need: 'Preserve human authority.', segment: 'Teams' }],
          category: 'Human-controlled brand operations',
          differentiators: ['Human heads are never overwritten by an agent.'],
          risks: [],
          summary: 'This agent output must be rejected.',
          valueProposition: 'Keep the human-authored head authoritative.',
        },
        database: requireDatabase(),
        execution: humanHeadExecution,
        expectedBrandContextObjectId: humanContextObjectId,
        requestId: `output:human-head:${randomUUID()}`,
      })
    ).rejects.toMatchObject({ code: 'access_denied' })
    const [preservedHumanHead] = await requireDatabase()
      .select({ id: objects.id, producedBy: objects.producedBy })
      .from(objects)
      .where(
        and(
          eq(objects.brandId, humanHeadWork.brandId),
          eq(objects.singletonKey, 'brand-context'),
          eq(objects.status, 'active')
        )
      )
      .limit(1)
    expect(preservedHumanHead).toEqual({
      id: humanContextObjectId,
      producedBy: humanContextActionId,
    })
  })
})
