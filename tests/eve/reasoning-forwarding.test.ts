import { describe, expect, it } from 'vitest'

import {
  callDefinitionHelper,
  findPrimaryInstalledEve,
  importPublicEveModule,
  importSourcePinnedEveModule,
  readRecord,
} from './installed-eve'

const EXPECTED_EVE_VERSION = '0.31.3'
const EXPECTED_REASONING = 'high'
const FIXTURE_MODEL_CONTEXT_WINDOW = 4096
const FIXTURE_REPLY = 'Eve forwarded reasoning high'

type ModelCallPath = 'generate' | 'stream'

interface ModelCallObservations {
  readonly generate: string[]
  readonly stream: string[]
}

interface HarnessTurnProbe {
  readonly result: Readonly<Record<string, unknown>>
  readonly streamedEventTypes: readonly string[]
}

const callModuleFactory = (
  moduleNamespace: Readonly<Record<string, unknown>>,
  exportName: string,
  input: unknown
): unknown => {
  const factory = moduleNamespace[exportName]
  if (typeof factory !== 'function') {
    throw new Error(`Expected Eve to export ${exportName}`)
  }
  const result: unknown = factory(input)
  return result
}

const callCompileAgentConfig = async (
  compilerModule: Readonly<Record<string, unknown>>,
  manifest: unknown,
  definition: unknown
): Promise<unknown> => {
  const { compileAgentConfig } = compilerModule
  if (typeof compileAgentConfig !== 'function') {
    throw new Error('Expected the source-pinned Eve agent compiler')
  }

  const modelCatalog = {
    getByProviderModelId: (): never => {
      throw new Error('The fixture context window must avoid a catalog lookup')
    },
    getModelLimits: (): never => {
      throw new Error('The fixture context window must avoid a catalog lookup')
    },
  }
  const compiled: unknown = await compileAgentConfig(
    manifest,
    { modelCatalog },
    { definition }
  )
  return compiled
}

const recordReasoning = (
  options: unknown,
  path: ModelCallPath,
  observations: ModelCallObservations
): void => {
  const { reasoning } = readRecord(options, `${path} model call options`)
  if (reasoning !== EXPECTED_REASONING) {
    throw new Error(
      `Expected ${path} reasoning ${EXPECTED_REASONING}, received ${String(reasoning)}`
    )
  }

  observations[path].push(reasoning)
}

const createReasoningGuardModel = (
  baseModel: unknown,
  observations: ModelCallObservations
): Readonly<Record<string, unknown>> => {
  const model = readRecord(baseModel, 'mockModel result')
  return new Proxy(model, {
    get(target, property, receiver): unknown {
      const original: unknown = Reflect.get(target, property, receiver)
      if (property !== 'doGenerate' && property !== 'doStream') {
        return original
      }
      if (typeof original !== 'function') {
        throw new Error(`Expected mockModel.${property} to be a function`)
      }

      const path = property === 'doGenerate' ? 'generate' : 'stream'
      return async (options: unknown): Promise<unknown> => {
        recordReasoning(options, path, observations)
        const result: unknown = Reflect.apply(original, target, [options])
        return await Promise.resolve(result)
      }
    },
  })
}

const createCompiledDefinition = async (
  installedEntry: Awaited<ReturnType<typeof findPrimaryInstalledEve>>,
  guardedModel: Readonly<Record<string, unknown>>
): Promise<Readonly<Record<string, unknown>>> => {
  const [eve, compiler, discovery] = await Promise.all([
    importPublicEveModule(installedEntry, 'eve'),
    importSourcePinnedEveModule(
      installedEntry,
      './compiler/normalize-agent-config.js'
    ),
    importSourcePinnedEveModule(installedEntry, './discover/manifest.js'),
  ])
  const configModule = callModuleFactory(discovery, 'createModuleSourceRef', {
    logicalPath: 'agent.ts',
  })
  const manifest = callModuleFactory(discovery, 'createAgentSourceManifest', {
    agentRoot: '/virtual/eve-reasoning-forwarding/agent',
    appRoot: '/virtual/eve-reasoning-forwarding',
    configModule,
    packageName: 'eve-reasoning-forwarding-fixture',
  })
  const definition = callDefinitionHelper(eve, 'defineAgent', {
    model: guardedModel,
    modelContextWindowTokens: FIXTURE_MODEL_CONTEXT_WINDOW,
    reasoning: EXPECTED_REASONING,
  })

  return readRecord(
    await callCompileAgentConfig(compiler, manifest, definition),
    'compiled agent definition'
  )
}

const createRuntimeSession = (
  sessionModule: Readonly<Record<string, unknown>>,
  compiledDefinition: Readonly<Record<string, unknown>>,
  suffix: ModelCallPath
): unknown => {
  const { createSession } = sessionModule
  if (typeof createSession !== 'function') {
    throw new Error('Expected the source-pinned Eve session factory')
  }

  const session: unknown = createSession({
    continuationToken: `fixture-continuation-${suffix}`,
    sessionId: `fixture-session-${suffix}`,
    turnAgent: {
      id: compiledDefinition.name,
      instructions: ['Reply with the deterministic fixture response.'],
      model: compiledDefinition.model,
      reasoning: compiledDefinition.reasoning,
      tools: [],
      workspaceSpec: { rootEntries: [] },
    },
  })
  return session
}

const runHarnessTurn = async (
  harnessModule: Readonly<Record<string, unknown>>,
  session: unknown,
  guardedModel: Readonly<Record<string, unknown>>,
  path: ModelCallPath
): Promise<HarnessTurnProbe> => {
  const { createToolLoopHarness } = harnessModule
  if (typeof createToolLoopHarness !== 'function') {
    throw new Error('Expected the source-pinned Eve tool-loop harness')
  }

  const streamedEventTypes: string[] = []
  const handleEvent =
    path === 'stream'
      ? (event: unknown): Promise<void> => {
          const { type } = readRecord(event, 'streamed event')
          if (typeof type !== 'string') {
            throw new Error('Expected every streamed event to have a type')
          }
          streamedEventTypes.push(type)
          return Promise.resolve()
        }
      : undefined
  const runStep: unknown = createToolLoopHarness({
    handleEvent,
    mode: 'task',
    resolveModel: async (): Promise<Readonly<Record<string, unknown>>> =>
      guardedModel,
    tools: new Map(),
  })
  if (typeof runStep !== 'function') {
    throw new Error('Expected the Eve harness factory to return a step')
  }

  const result: unknown = await runStep(session, {
    message: `Exercise the ${path} model-call path.`,
  })
  return {
    result: readRecord(result, `${path} harness result`),
    streamedEventTypes,
  }
}

describe('Eve reasoning forwarding', () => {
  it('forwards reasoning high through compiled sessions to both AI SDK call paths', async () => {
    const installed = await findPrimaryInstalledEve()
    expect(installed.version).toBe(EXPECTED_EVE_VERSION)

    const evals = await importPublicEveModule(installed, 'eve/evals')
    const { mockModel } = evals
    if (typeof mockModel !== 'function') {
      throw new Error('Expected eve/evals to export mockModel')
    }

    const observations: ModelCallObservations = {
      generate: [],
      stream: [],
    }
    const baseModel: unknown = mockModel(FIXTURE_REPLY)
    const guardedModel = createReasoningGuardModel(baseModel, observations)
    const compiledDefinition = await createCompiledDefinition(
      installed,
      guardedModel
    )
    expect(compiledDefinition.reasoning).toBe(EXPECTED_REASONING)

    const [harnessModule, sessionModule] = await Promise.all([
      importSourcePinnedEveModule(installed, './harness/tool-loop.js'),
      importSourcePinnedEveModule(installed, './execution/session.js'),
    ])
    const generateSession = createRuntimeSession(
      sessionModule,
      compiledDefinition,
      'generate'
    )
    const streamSession = createRuntimeSession(
      sessionModule,
      compiledDefinition,
      'stream'
    )
    expect(
      readRecord(
        readRecord(generateSession, 'generated session').agent,
        'generated session agent'
      ).reasoning
    ).toBe(EXPECTED_REASONING)

    const [generateProbe, streamProbe] = await Promise.all([
      runHarnessTurn(harnessModule, generateSession, guardedModel, 'generate'),
      runHarnessTurn(harnessModule, streamSession, guardedModel, 'stream'),
    ])

    expect(streamProbe.streamedEventTypes).toContain('step.completed')
    expect(streamProbe.streamedEventTypes.at(-1)).toBe('session.completed')
    expect(readRecord(generateProbe.result.next, 'generate next')).toEqual({
      done: true,
      output: FIXTURE_REPLY,
    })
    expect(readRecord(streamProbe.result.next, 'stream next')).toEqual({
      done: true,
      output: FIXTURE_REPLY,
    })
    expect(observations).toEqual({
      generate: [EXPECTED_REASONING],
      stream: [EXPECTED_REASONING],
    })
  })
})
