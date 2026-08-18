import { readdirSync } from 'node:fs'

import { productMarketerContextContentSchema } from '@repo/brain/objects'
import type { ClaimedProductMarketerTask } from '@repo/brain/tasks'
import type { ChannelFrom, ChannelSendOptions, Session } from 'eve/channels'
import { describe, expect, it } from 'vitest'

import rootAgent from './agent'
import {
  createDispatchHandler,
  type DispatchHandlerDependencies,
  drainProductMarketerTasks,
} from './channels/dispatch'
import {
  ROOT_RUNTIME_CONTRACT,
  resolveDeploymentEnvironment,
} from './lib/root-contract'
import {
  createProductMarketerSessionAuth,
  productMarketerSessionLineageFromContext,
  productMarketerTaskAddress,
  readProductMarketerSessionIdentity,
  requireProductMarketerRootSession,
  stableTaskRequestId,
  taskExecutionFromContext,
} from './lib/task-runtime'
import { finishTaskInputSchema } from './tools/finish_task'

const DISPATCH_SECRET = 'dispatch-secret-at-least-32-characters'
const STABLE_CONTEXT_REQUEST_PATTERN = /^eve:save-brand-context:[0-9a-f]{64}$/u

const request = ({
  body,
  query = '',
  secret = DISPATCH_SECRET,
}: {
  readonly body?: string
  readonly query?: string
  readonly secret?: string | null
} = {}): Request => {
  const headers = new Headers()
  if (secret !== null) {
    headers.set('authorization', `Bearer ${secret}`)
  }
  return new Request(`https://agent.example/internal/dispatch${query}`, {
    body,
    headers,
    method: 'POST',
  })
}

const handler = (
  readSecret: DispatchHandlerDependencies['readSecret'] = () => DISPATCH_SECRET,
  drain: DispatchHandlerDependencies['drain'] = async () => undefined
) => createDispatchHandler({ drain, readSecret })

const noActiveSession = async () => ({ status: 'no_active_session' as const })

const session = (id: string): Session => ({
  cancel: async () => ({ status: 'no_active_turn' }),
  clear: noActiveSession,
  compact: noActiveSession,
  getEventStream: async () => new ReadableStream(),
  getStreamTailIndex: async () => -1,
  id,
  reset: noActiveSession,
  respond: async () => ({ status: 'session_not_active' }),
  send: async () => ({ status: 'session_not_active' }),
})

const claim: ClaimedProductMarketerTask = {
  agentActorId: '00000000-0000-0000-0000-000000000102',
  agentActorKey: 'agent:product-marketer',
  brandContextContent: { summary: 'Current context' },
  brandContextObjectId: '00000000-0000-0000-0000-000000000202',
  brandId: '00000000-0000-0000-0000-000000000201',
  intentSnapshot: {
    acceptance_criteria: [{ metric: 'qualified demand' }],
    brand_id: '00000000-0000-0000-0000-000000000201',
    constraints: null,
    intent_id: '00000000-0000-0000-0000-000000000203',
    intent_revision: 1,
    preauthorizations: [],
    statement: 'Clarify the value proposition',
  },
  kind: 'product-marketer.brand-context.v1',
  payload: { purpose: 'enrich_brand_context' },
  startedAt: new Date('2026-08-17T10:00:00.000Z'),
  taskId: '00000000-0000-4000-8000-000000000204',
  workerKey: 'product-marketer',
}

const route = ({
  from = () => ({
    cancel: async () => ({ status: 'no_active_turn' as const }),
    clear: noActiveSession,
    compact: noActiveSession,
    reset: noActiveSession,
    respond: async () => session('unused'),
    send: async () => session('session-1'),
  }),
  waitUntil = () => undefined,
}: {
  readonly from?: ChannelFrom
  readonly waitUntil?: (task: Promise<unknown>) => void
} = {}) => ({ from, waitUntil })

const trustedTaskContext = (taskClaim: ClaimedProductMarketerTask = claim) => {
  const auth = createProductMarketerSessionAuth(taskClaim)
  return {
    session: {
      auth: { current: auth, initiator: auth },
      id: 'session-product-marketer',
      turn: { id: 'turn-product-marketer', sequence: 0 },
    },
  }
}

describe('Product Marketer root runtime', () => {
  it('uses the sole Phase 0 task kind and public Eve health route', () => {
    expect(ROOT_RUNTIME_CONTRACT).toMatchObject({
      agentKey: 'product-marketer',
      functional: true,
      health: { method: 'GET', path: '/eve/v1/health', public: true },
    })
    expect(ROOT_RUNTIME_CONTRACT.dispatch.supportedTaskKinds).toEqual([
      'product-marketer.brand-context.v1',
    ])
  })

  it('uses high reasoning without a custom compaction threshold', () => {
    expect(rootAgent.reasoning).toBe('high')
    expect(rootAgent).not.toHaveProperty('compaction')
  })

  it('enables Eve native self-copy without an authored agent override', () => {
    expect(readdirSync(new URL('./tools/', import.meta.url))).not.toContain(
      'agent.ts'
    )
  })

  it('maps deployment environments without accepting arbitrary values', () => {
    expect(resolveDeploymentEnvironment({ NODE_ENV: 'test' })).toBe('test')
    expect(
      resolveDeploymentEnvironment({
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
      })
    ).toBe('preview')
    expect(resolveDeploymentEnvironment({ NODE_ENV: 'production' })).toBe(
      'production'
    )
    expect(resolveDeploymentEnvironment({ VERCEL_ENV: 'unknown' })).toBe(
      'development'
    )
  })

  it('derives task authority from session auth and keeps request identity stable', () => {
    const context = trustedTaskContext()
    expect(readProductMarketerSessionIdentity(context)).toMatchObject({
      agentActorId: claim.agentActorId,
      brandContextObjectId: claim.brandContextObjectId,
      brandId: claim.brandId,
      startedAt: claim.startedAt,
      taskId: claim.taskId,
    })
    const first = stableTaskRequestId({
      context,
      operation: 'save-brand-context',
      semantics: { summary: 'Refined context' },
    })
    const second = stableTaskRequestId({
      context,
      operation: 'save-brand-context',
      semantics: { summary: 'Refined context' },
    })
    expect(first).toBe(second)
    expect(first).toMatch(STABLE_CONTEXT_REQUEST_PATTERN)

    const reclaimedContext = trustedTaskContext({
      ...claim,
      startedAt: new Date(claim.startedAt.getTime() + 1),
    })
    expect(
      stableTaskRequestId({
        context: reclaimedContext,
        operation: 'save-brand-context',
        semantics: { summary: 'Refined context' },
      })
    ).not.toBe(first)
  })

  it('preserves trusted task authority and exact lineage in a self-copy', () => {
    const rootContext = trustedTaskContext()
    const childContext = {
      session: {
        ...rootContext.session,
        id: 'session-product-marketer-child',
        parent: {
          callId: 'call-product-marketer-child',
          rootSessionId: rootContext.session.id,
          sessionId: rootContext.session.id,
          turn: rootContext.session.turn,
        },
      },
    }

    expect(readProductMarketerSessionIdentity(childContext)).toMatchObject({
      brandId: claim.brandId,
      rootSessionId: rootContext.session.id,
      sessionId: childContext.session.id,
      taskId: claim.taskId,
    })
    expect(taskExecutionFromContext(childContext)).toMatchObject({
      rootSessionId: rootContext.session.id,
      sessionId: childContext.session.id,
      taskId: claim.taskId,
    })
    expect(productMarketerSessionLineageFromContext(childContext)).toEqual({
      kind: 'child',
      parentCallId: 'call-product-marketer-child',
      parentSessionId: rootContext.session.id,
      rootSessionId: rootContext.session.id,
      sessionId: childContext.session.id,
    })
    expect(() => requireProductMarketerRootSession(rootContext)).not.toThrow()
    expect(() => requireProductMarketerRootSession(childContext)).toThrow(
      'FINISH_TASK_ROOT_ONLY'
    )
  })

  it('requires matching scalar auth throughout the self-copy tree', () => {
    const trustedContext = trustedTaskContext()
    expect(() =>
      readProductMarketerSessionIdentity({
        session: {
          ...trustedContext.session,
          auth: {
            current: null,
            initiator: trustedContext.session.auth.initiator,
          },
        },
      })
    ).toThrow('session authentication is missing')
    expect(() =>
      readProductMarketerSessionIdentity({
        session: {
          ...trustedContext.session,
          auth: {
            current: {
              ...trustedContext.session.auth.current,
              attributes: {
                ...trustedContext.session.auth.current.attributes,
                brand_id: '00000000-0000-0000-0000-000000000999',
              },
            },
            initiator: trustedContext.session.auth.initiator,
          },
        },
      })
    ).toThrow('session authority changed')
  })

  it('uses one continuation address per persisted claim generation', () => {
    expect(
      productMarketerTaskAddress({
        startedAt: new Date(claim.startedAt),
        taskId: claim.taskId,
      })
    ).toBe(productMarketerTaskAddress(claim))
    expect(
      productMarketerTaskAddress({
        startedAt: new Date(claim.startedAt.getTime() + 1),
        taskId: claim.taskId,
      })
    ).not.toBe(productMarketerTaskAddress(claim))
  })

  it('keeps trusted task and Object identifiers out of model tool inputs', () => {
    const brandContext = {
      audiences: [{ need: 'Make demand more qualified', segment: 'CMOs' }],
      category: 'Marketing operating system',
      differentiators: ['Canonical provenance'],
      risks: [],
      summary: 'A CMO-led marketing operating system.',
      valueProposition: 'Turn explicit intent into governed marketing work.',
    }
    expect(
      productMarketerContextContentSchema.safeParse(brandContext).success
    ).toBe(true)
    expect(
      productMarketerContextContentSchema.safeParse({
        ...brandContext,
        taskId: claim.taskId,
      }).success
    ).toBe(false)
    expect(
      finishTaskInputSchema.safeParse({
        brandContextObjectId: claim.brandContextObjectId,
        status: 'completed',
        summary: 'Brand Context enriched.',
      }).success
    ).toBe(false)
    expect(
      finishTaskInputSchema.safeParse({
        status: 'completed',
        summary: 'Brand Context enriched.',
      }).success
    ).toBe(true)
  })

  it('fails closed when the dispatch secret is missing or invalid', async () => {
    await expect(
      handler(() => undefined)(request(), route())
    ).resolves.toMatchObject({ status: 503 })
    await expect(
      handler()(request({ secret: null }), route())
    ).resolves.toMatchObject({ status: 401 })
    await expect(
      handler()(
        request({ secret: 'wrong-secret-at-least-32-characters' }),
        route()
      )
    ).resolves.toMatchObject({ status: 401 })
  })

  it('rejects selectors and every non-empty body', async () => {
    await expect(
      handler()(request({ query: '?worker=product-marketer' }), route())
    ).resolves.toMatchObject({ status: 400 })
    await expect(
      handler()(request({ body: '{}' }), route())
    ).resolves.toMatchObject({ status: 400 })
  })

  it('registers the bounded background drain before acknowledging the poke', async () => {
    const registered: Promise<unknown>[] = []
    const drain = async () => undefined
    const response = await handler(() => DISPATCH_SECRET, drain)(
      request(),
      route({ waitUntil: (task) => registered.push(task) })
    )
    expect(response.status).toBe(202)
    await expect(response.text()).resolves.toBe('')
    expect(registered).toHaveLength(1)
    await expect(registered[0]).resolves.toBeUndefined()
  })

  it('registers a synchronous drain startup failure before acknowledging', async () => {
    const registered: Promise<unknown>[] = []
    const response = await handler(
      () => DISPATCH_SECRET,
      () => {
        throw new Error('drain startup failed')
      }
    )(request(), route({ waitUntil: (task) => registered.push(task) }))
    expect(response.status).toBe(202)
    expect(registered).toHaveLength(1)
    await expect(registered[0]).rejects.toThrow('drain startup failed')
  })

  it('sends a bounded task-mode run and binds only the accepted session', async () => {
    const sent: Array<{
      readonly address: string
      readonly options: ChannelSendOptions
    }> = []
    const bound: string[] = []
    let claims = 0
    const from: ChannelFrom = (address) => ({
      cancel: async () => ({ status: 'no_active_turn' }),
      clear: noActiveSession,
      compact: noActiveSession,
      reset: noActiveSession,
      respond: async () => session('unused'),
      send: (_message, options) => {
        sent.push({ address, options })
        return Promise.resolve(session('session-product-marketer'))
      },
    })

    await drainProductMarketerTasks({
      dependencies: {
        bindSession: ({ sessionId }) => {
          bound.push(sessionId)
          return Promise.resolve()
        },
        claimTask: () => {
          claims += 1
          return Promise.resolve(claims === 1 ? claim : null)
        },
        failDelivery: async () => undefined,
        now: () => new Date('2026-08-17T10:00:00.000Z'),
      },
      from,
      limit: 2,
    })

    expect(sent).toHaveLength(1)
    const [firstSent] = sent
    if (firstSent === undefined) {
      throw new Error('Expected one accepted Product Marketer send')
    }
    expect(firstSent).toMatchObject({
      address: productMarketerTaskAddress(claim),
      options: {
        auth: {
          attributes: {
            brand_id: claim.brandId,
            task_id: claim.taskId,
            task_started_at: claim.startedAt.toISOString(),
          },
        },
        mode: 'task',
        title: `Product Marketer task ${claim.taskId}`,
      },
    })
    expect(firstSent.options.outputSchema).toBeDefined()
    expect(bound).toEqual(['session-product-marketer'])
  })

  it('terminalizes only a send rejection, not an ambiguous post-acceptance bind error', async () => {
    const sendFailures: string[] = []
    const rejectingFrom: ChannelFrom = () => ({
      cancel: async () => ({ status: 'no_active_turn' }),
      clear: noActiveSession,
      compact: noActiveSession,
      reset: noActiveSession,
      respond: async () => session('unused'),
      send: () => Promise.reject(new Error('delivery rejected')),
    })
    await expect(
      drainProductMarketerTasks({
        dependencies: {
          bindSession: async () => undefined,
          claimTask: async () => claim,
          failDelivery: ({ claim: failedClaim }) => {
            sendFailures.push(failedClaim.taskId)
            return Promise.resolve()
          },
          now: () => new Date('2026-08-17T10:00:00.000Z'),
        },
        from: rejectingFrom,
        limit: 1,
      })
    ).rejects.toThrow('delivery rejected')
    expect(sendFailures).toEqual([claim.taskId])

    let failDeliveryCalls = 0
    await expect(
      drainProductMarketerTasks({
        dependencies: {
          bindSession: () => Promise.reject(new Error('bind ambiguous')),
          claimTask: async () => claim,
          failDelivery: () => {
            failDeliveryCalls += 1
            return Promise.resolve()
          },
          now: () => new Date('2026-08-17T10:00:00.000Z'),
        },
        from: route().from,
        limit: 1,
      })
    ).rejects.toThrow('bind ambiguous')
    expect(failDeliveryCalls).toBe(0)
  })
})
