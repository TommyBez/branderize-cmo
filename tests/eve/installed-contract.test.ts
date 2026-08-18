import { describe, expect, it } from 'vitest'

import {
  callCreateCompactionConfig,
  callDefinitionHelper,
  findInstalledEvePackages,
  findPrimaryInstalledEve,
  importPublicEveModule,
  importSourcePinnedEveModule,
  readFixture,
  readRecord,
} from './installed-eve'

const EXPECTED_EVE_VERSION = '0.31.3'
const PHASE_ZERO_MODEL_ID = 'deepseek/deepseek-v4-pro-0813'
const PHASE_ZERO_CONTEXT_WINDOW = 1_000_000
const DEFAULT_COMPACTION_THRESHOLD = 0.9

describe('installed Eve contract', () => {
  it('resolves the exact 0.31.3 package for every current Eve app', async () => {
    const installed = await findInstalledEvePackages()

    expect(installed.length).toBeGreaterThan(0)
    for (const packageEntry of installed) {
      expect(packageEntry.dependencySpecifier).toBe(EXPECTED_EVE_VERSION)
      expect(packageEntry.version).toBe(EXPECTED_EVE_VERSION)
    }
  })

  it('keeps the complete Phase 0 selection at session scope', async () => {
    const installed = await findPrimaryInstalledEve()
    const eve = await importPublicEveModule(installed, 'eve')
    const selection = {
      model: PHASE_ZERO_MODEL_ID,
      modelContextWindowTokens: PHASE_ZERO_CONTEXT_WINDOW,
      modelOptions: {
        providerOptions: {
          gateway: {
            tags: [
              'agent:cmo',
              'environment:test',
              'feature:conversation',
              'lane:direct',
            ],
            user: 'brand_fixture_01',
          },
        },
      },
    }
    const resolveAtSessionStart = (): typeof selection => selection
    const dynamicDefinition = callDefinitionHelper(eve, 'defineDynamic', {
      events: { 'session.started': resolveAtSessionStart },
      fallback: PHASE_ZERO_MODEL_ID,
    })
    const dynamicRecord = readRecord(dynamicDefinition, 'dynamic definition')

    expect(dynamicRecord.kind).toBe('eve:dynamic')
    expect(dynamicRecord.fallback).toBe(PHASE_ZERO_MODEL_ID)
    expect(
      readRecord(dynamicRecord.events, 'dynamic events')['session.started']
    ).toBe(resolveAtSessionStart)
    expect(resolveAtSessionStart()).toEqual(selection)
  })

  it('retains reasoning high at the authored definition boundary', async () => {
    const installed = await findPrimaryInstalledEve()
    const eve = await importPublicEveModule(installed, 'eve')
    const dynamicDefinition = callDefinitionHelper(eve, 'defineDynamic', {
      events: {
        'session.started': () => ({
          model: PHASE_ZERO_MODEL_ID,
          modelContextWindowTokens: PHASE_ZERO_CONTEXT_WINDOW,
        }),
      },
      fallback: PHASE_ZERO_MODEL_ID,
    })
    const agentDefinition = callDefinitionHelper(eve, 'defineAgent', {
      model: dynamicDefinition,
      modelContextWindowTokens: PHASE_ZERO_CONTEXT_WINDOW,
      reasoning: 'high',
    })

    expect(readRecord(agentDefinition, 'agent definition').reasoning).toBe(
      'high'
    )
  })

  it('uses the source-pinned 0.9 compaction default when unset', async () => {
    const installed = await findPrimaryInstalledEve()
    expect(installed.version).toBe(EXPECTED_EVE_VERSION)

    const sessionModule = await importSourcePinnedEveModule(
      installed,
      './execution/session.js'
    )
    const config = callCreateCompactionConfig(
      sessionModule,
      PHASE_ZERO_CONTEXT_WINDOW
    )

    expect(config.threshold).toBe(
      PHASE_ZERO_CONTEXT_WINDOW * DEFAULT_COMPACTION_THRESHOLD
    )
    expect(config.recentWindowSize).toBe(10)
  })

  it('keeps real Gateway reasoning evidence outside deterministic CI', async () => {
    const canary = readRecord(
      await readFixture('hosted-gateway-canary.json'),
      'hosted canary'
    )

    expect(canary.status).toBe('not_verified')
    expect(canary.model).toBe(PHASE_ZERO_MODEL_ID)
    expect(canary.reasoning).toBe('high')
    expect(canary.excludedEvidence).toEqual([
      'Synthetic reasoning events in reducer fixtures.',
    ])
  })
})
