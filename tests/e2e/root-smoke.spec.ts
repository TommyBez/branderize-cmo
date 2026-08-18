import { readdir, readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { Client } from '../../apps/agent-cmo/node_modules/eve/dist/src/client/index.js'
import { ROOT_SMOKE_PROMPT } from './preload/scripted-inference.mjs'
import {
  functionalAgentOrigins,
  healthOnlyAgentOrigins,
  providerStateDirectory,
} from './support/environment'

const SCRIPTED_MODEL_ID = 'deepseek/deepseek-v4-pro-0813'
const GATEWAY_TRACE_FILE_PATTERN = /^gateway-\d+-\d{4}\.json$/u

const HEALTH_ONLY_ROOTS = [
  {
    agent: 'content',
    feature: 'content',
    name: 'agent-content',
    origin: healthOnlyAgentOrigins.content,
  },
  {
    agent: 'distribution',
    feature: 'distribution',
    name: 'agent-distribution',
    origin: healthOnlyAgentOrigins.distribution,
  },
  {
    agent: 'growth',
    feature: 'growth',
    name: 'agent-growth',
    origin: healthOnlyAgentOrigins.growth,
  },
  {
    agent: 'lifecycle',
    feature: 'lifecycle',
    name: 'agent-lifecycle',
    origin: healthOnlyAgentOrigins.lifecycle,
  },
  {
    agent: 'seo-discovery',
    feature: 'seo-discovery',
    name: 'agent-seo-discovery',
    origin: healthOnlyAgentOrigins['seo-discovery'],
  },
] as const

const FUNCTIONAL_ROOTS = [
  {
    name: 'agent-cmo',
    origin: functionalAgentOrigins.cmo,
  },
  {
    name: 'agent-product-marketer',
    origin: functionalAgentOrigins['product-marketer'],
  },
] as const
const PROTECTED_SPECIALIST_ROOTS = [
  FUNCTIONAL_ROOTS[1],
  ...HEALTH_ONLY_ROOTS,
] as const
const ALL_ROOTS = [...FUNCTIONAL_ROOTS, ...HEALTH_ONLY_ROOTS] as const

interface ScriptedRootTrace {
  readonly agent: string
  readonly lane: string
  readonly modelId: string
  readonly providerOptions: {
    readonly tags: readonly string[]
    readonly user?: string
  } | null
}

interface RootPreflightReceipt {
  readonly agent: string
  readonly eventTypes: readonly string[]
  readonly infoName: string
  readonly modelId: string
  readonly reasoning: string
  readonly resultStatus: string
  readonly sessionId: string
  readonly workflowId: string
}

const inspectRoot = async (root: (typeof ALL_ROOTS)[number]) => {
  const client = new Client({ host: root.origin, redirect: 'error' })
  const health = await client.health()
  return { health, root }
}

const inspectProductionAuthFence = async (
  root: (typeof PROTECTED_SPECIALIST_ROOTS)[number]
) => {
  const [info, session] = await Promise.all([
    fetch(`${root.origin}/eve/v1/info`, { redirect: 'manual' }),
    fetch(`${root.origin}/eve/v1/session`, {
      body: JSON.stringify({ message: ROOT_SMOKE_PROMPT }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      redirect: 'manual',
    }),
  ])
  return { info, root, session }
}

const readRootTraces = async (): Promise<readonly ScriptedRootTrace[]> => {
  const entries = await readdir(providerStateDirectory, {
    withFileTypes: true,
  })
  return await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && GATEWAY_TRACE_FILE_PATTERN.test(entry.name)
      )
      .map(async (entry) => {
        const source = await readFile(
          `${providerStateDirectory}/${entry.name}`,
          'utf8'
        )
        return JSON.parse(source) as ScriptedRootTrace
      })
  )
}

const readRootPreflightReceipts = async (): Promise<
  readonly RootPreflightReceipt[]
> =>
  await Promise.all(
    HEALTH_ONLY_ROOTS.map(async ({ agent }) => {
      const source = await readFile(
        `${providerStateDirectory}/root-preflight-${agent}.json`,
        'utf8'
      )
      return JSON.parse(source) as RootPreflightReceipt
    })
  )

test('all seven built roots expose health while inactive roots stay protected', async () => {
  test.setTimeout(120_000)
  const inspections = await Promise.all(ALL_ROOTS.map(inspectRoot))

  for (const { health } of inspections) {
    expect(health).toMatchObject({ ok: true, status: 'ready' })
    expect(health.workflowId).not.toHaveLength(0)
  }

  const protectedInspections = await Promise.all(
    PROTECTED_SPECIALIST_ROOTS.map(inspectProductionAuthFence)
  )
  for (const { info, session } of protectedInspections) {
    expect(info.status).toBe(401)
    expect(info.headers.get('www-authenticate')).toBe('Bearer')
    expect(session.status).toBe(401)
    expect(session.headers.get('www-authenticate')).toBe('Bearer')
  }
})

test('all five inactive roots completed an isolated Eve dev session', async () => {
  test.setTimeout(120_000)
  const receipts = await readRootPreflightReceipts()

  for (const root of HEALTH_ONLY_ROOTS) {
    const receipt = receipts.find((candidate) => candidate.agent === root.agent)
    expect(receipt).toMatchObject({
      agent: root.agent,
      infoName: root.name,
      modelId: SCRIPTED_MODEL_ID,
      reasoning: 'high',
      resultStatus: 'waiting',
    })
    expect(receipt?.sessionId).not.toHaveLength(0)
    expect(receipt?.workflowId).not.toHaveLength(0)
    expect(receipt?.eventTypes).toEqual(
      expect.arrayContaining(['turn.completed', 'session.waiting'])
    )
  }

  const traces = await readRootTraces()
  for (const root of HEALTH_ONLY_ROOTS) {
    const trace = traces.find(
      (candidate) => candidate.agent === root.agent && candidate.lane === 'task'
    )
    expect(trace).toMatchObject({
      agent: root.agent,
      lane: 'task',
      modelId: SCRIPTED_MODEL_ID,
    })
    expect(trace?.providerOptions?.tags ?? []).not.toEqual(
      expect.arrayContaining([`agent:${root.agent}`, 'lane:task'])
    )
    expect(trace?.providerOptions?.user).toBeUndefined()
  }
})
