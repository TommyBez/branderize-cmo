import type { ClaimedTask } from '@repo/brain/tasks'
import { taskGenerationOf } from '@repo/brain/tasks'
import type { ChannelFrom, ChannelSendOptions, Session } from 'eve/channels'
import { describe, expect, it } from 'vitest'

import {
  createSpecialistDispatchHandler,
  type SpecialistDispatchHandlerDependencies,
} from './dispatch-channel'
import { drainSpecialistTasks } from './drain'
import { createTaskSessionAuth, taskAddressOf } from './session-envelope'

const DISPATCH_SECRET = 'dispatch-secret-at-least-32-characters'
const PRODUCT_MARKETER_KIND = 'product-marketer.brand-context.v1' as const

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
  readSecret: SpecialistDispatchHandlerDependencies['readSecret'] = () =>
    DISPATCH_SECRET,
  drain: SpecialistDispatchHandlerDependencies['drain'] = async () => undefined
) => createSpecialistDispatchHandler({ drain, readSecret })

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

const claim: ClaimedTask = {
  agentActorId: '00000000-0000-0000-0000-000000000102',
  agentActorKey: 'agent:product-marketer',
  brandId: '00000000-0000-0000-0000-000000000201',
  claimContext: {
    brandContextContent: { summary: 'Current context' },
    brandContextObjectId: '00000000-0000-0000-0000-000000000202',
  },
  intentSnapshot: {
    acceptance_criteria: [{ metric: 'qualified demand' }],
    brand_id: '00000000-0000-0000-0000-000000000201',
    constraints: null,
    intent_id: '00000000-0000-0000-0000-000000000203',
    intent_revision: 1,
    preauthorizations: [],
    statement: 'Clarify the value proposition',
  },
  kind: PRODUCT_MARKETER_KIND,
  payload: { purpose: 'enrich_brand_context' },
  startedAt: taskGenerationOf(new Date('2026-08-17T10:00:00.000Z')),
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

describe('specialist dispatch and drain', () => {
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

    await expect(
      drainSpecialistTasks({
        budget: 2,
        from,
        kinds: [PRODUCT_MARKETER_KIND],
        lifecycle: {
          bindDelivery: ({ sessionId }) => {
            bound.push(sessionId)
            return Promise.resolve()
          },
          claimNextDue: () => {
            claims += 1
            return Promise.resolve(claims === 1 ? claim : null)
          },
          failDelivery: async () => undefined,
        },
        now: () => new Date('2026-08-17T10:00:00.000Z'),
        workerKey: 'product-marketer',
      })
    ).resolves.toEqual({ bound: 1 })

    expect(sent).toHaveLength(1)
    const [firstSent] = sent
    if (firstSent === undefined) {
      throw new Error('Expected one accepted specialist send')
    }
    expect(firstSent).toMatchObject({
      address: taskAddressOf(claim),
      options: {
        auth: {
          attributes: {
            brand_id: claim.brandId,
            task_id: claim.taskId,
            task_started_at: claim.startedAt.toISOString(),
          },
          authenticator: 'product-marketer-dispatch',
        },
        mode: 'task',
        title: `Product Marketer task ${claim.taskId}`,
      },
    })
    expect(firstSent.options.auth).toEqual(createTaskSessionAuth(claim))
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
      drainSpecialistTasks({
        budget: 1,
        from: rejectingFrom,
        kinds: [PRODUCT_MARKETER_KIND],
        lifecycle: {
          bindDelivery: async () => undefined,
          claimNextDue: async () => claim,
          failDelivery: ({ claim: failedClaim }) => {
            sendFailures.push(failedClaim.taskId)
            return Promise.resolve()
          },
        },
        now: () => new Date('2026-08-17T10:00:00.000Z'),
        workerKey: 'product-marketer',
      })
    ).rejects.toThrow('delivery rejected')
    expect(sendFailures).toEqual([claim.taskId])

    let failDeliveryCalls = 0
    await expect(
      drainSpecialistTasks({
        budget: 1,
        from: route().from,
        kinds: [PRODUCT_MARKETER_KIND],
        lifecycle: {
          bindDelivery: () => Promise.reject(new Error('bind ambiguous')),
          claimNextDue: async () => claim,
          failDelivery: () => {
            failDeliveryCalls += 1
            return Promise.resolve()
          },
        },
        now: () => new Date('2026-08-17T10:00:00.000Z'),
        workerKey: 'product-marketer',
      })
    ).rejects.toThrow('bind ambiguous')
    expect(failDeliveryCalls).toBe(0)
  })
})
