import { createHmac } from 'node:crypto'
import { readdirSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import rootAgent from './agent'
import {
  createDispatchHandler,
  type DispatchHandlerDependencies,
} from './channels/dispatch'
import { createCmoBridgeAuth } from './lib/cmo-bridge-auth'
import {
  ROOT_RUNTIME_CONTRACT,
  resolveDeploymentEnvironment,
} from './lib/root-contract'
import {
  readCmoSessionIdentity,
  readCurrentCmoSourceTaskId,
  stableCmoRequestId,
} from './lib/runtime-access'
import productMarketerSubagent, {
  productMarketerConsultationModel,
} from './subagents/product-marketer/agent'
import { declareIntentToolInputSchema } from './tools/declare_intent'
import { refineIntentToolInputSchema } from './tools/refine_intent'
import {
  attachImmediateProductMarketerDispatch,
  requestSpecialistWorkToolInputSchema,
} from './tools/request_specialist_work'
import { resolveProductMarketerQuestionsToolInputSchema } from './tools/resolve_product_marketer_questions'

const DISPATCH_SECRET = 'dispatch-secret-at-least-32-characters'
const CMO_BRIDGE_SECRET = 'cmo-bridge-secret-at-least-32-chars'
const CURRENT_TIME = Math.floor(Date.now() / 1000)
const STABLE_REFINE_REQUEST_PATTERN = /^eve:refine-intent:[0-9a-f]{64}$/u
const SOURCE_TASK_ID = '11111111-1111-4111-8111-111111111204'
const CREATED_SPECIALIST_WORK_RECEIPT = {
  actionId: '11111111-1111-4111-8111-111111111205',
  disposition: 'created',
  intentId: '11111111-1111-4111-8111-111111111206',
  intentRevision: 1,
  outcome: 'specialist_work_requested',
  taskId: '11111111-1111-4111-8111-111111111207',
} as const

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
  readSecret: DispatchHandlerDependencies['readSecret'] = () => DISPATCH_SECRET
) => createDispatchHandler({ readSecret })

const signBridgeToken = (
  claims: Readonly<Record<string, unknown>>,
  secret = CMO_BRIDGE_SECRET
): string => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const unsignedToken = `${header}.${payload}`
  const signature = createHmac('sha256', secret)
    .update(unsignedToken)
    .digest('base64url')
  return `${unsignedToken}.${signature}`
}

const bridgeClaims = (
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> => ({
  aud: 'agent-cmo',
  brand_id: 'brand-1',
  conversation_id: 'conversation-1',
  exp: CURRENT_TIME + 60,
  iat: CURRENT_TIME,
  iss: 'branderize-app',
  jti: 'bridge-request-1',
  sub: 'user-1',
  ...overrides,
})

const authenticateBridgeToken = async (
  token: string,
  secret = CMO_BRIDGE_SECRET
) => {
  const auth = createCmoBridgeAuth({
    nowSeconds: () => CURRENT_TIME,
    readSecret: () => secret,
  })
  return await auth(
    new Request('https://agent.example/eve/v1/session', {
      headers: { authorization: `Bearer ${token}` },
    })
  )
}

const trustedSessionContext = (sourceTaskId?: string) => {
  const initiatingAuth = {
    attributes: {
      brand_id: '00000000-0000-0000-0000-000000000201',
      conversation_id: '00000000-0000-0000-0000-000000000202',
    },
    authenticator: 'cmo-bridge',
    issuer: 'branderize-app',
    principalId: 'user-1',
    principalType: 'user',
    subject: 'user-1',
  }
  const currentAuth = {
    ...initiatingAuth,
    attributes: {
      ...initiatingAuth.attributes,
      ...(sourceTaskId === undefined ? {} : { source_task_id: sourceTaskId }),
    },
  }
  return {
    session: {
      auth: { current: currentAuth, initiator: initiatingAuth },
      id: 'session-1',
      turn: { id: 'turn-1', sequence: 0 },
    },
  }
}

describe('CMO root runtime', () => {
  it('uses the shared functional manifest and public Eve health route', () => {
    expect(ROOT_RUNTIME_CONTRACT).toMatchObject({
      agentKey: 'cmo',
      functional: true,
      health: { method: 'GET', path: '/eve/v1/health', public: true },
    })
    expect(ROOT_RUNTIME_CONTRACT.dispatch.supportedTaskKinds).toEqual([])
  })

  it('uses high reasoning without a custom compaction threshold', () => {
    expect(rootAgent.reasoning).toBe('high')
    expect(rootAgent).not.toHaveProperty('compaction')
  })

  it('uses Eve native self-copy and declares only Product Marketer', () => {
    const rootTools = readdirSync(new URL('./tools/', import.meta.url)).sort()
    const declaredSubagents = readdirSync(
      new URL('./subagents/', import.meta.url),
      { withFileTypes: true }
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(rootTools).not.toContain('agent.ts')
    expect(declaredSubagents).toEqual(['product-marketer'])
  })

  it('exposes a high-reasoning read-only Product Marketer subagent', () => {
    expect(productMarketerSubagent).toMatchObject({
      description: expect.stringContaining('read-only'),
      reasoning: 'high',
    })
    expect(productMarketerSubagent).not.toHaveProperty('compaction')
    expect(
      readdirSync(
        new URL('./subagents/product-marketer/tools/', import.meta.url)
      ).sort()
    ).toEqual([
      'ask_question.ts',
      'bash.ts',
      'glob.ts',
      'grep.ts',
      'load_skill.ts',
      'read_file.ts',
      'todo.ts',
      'web_fetch.ts',
      'web_search.ts',
      'write_file.ts',
    ])
  })

  it('attributes the declared Product Marketer to the consultation lane', async () => {
    const resolveAtSessionStart =
      productMarketerConsultationModel.events['session.started']
    if (resolveAtSessionStart === undefined) {
      throw new Error('Expected the consultation session resolver')
    }
    const trustedContext = trustedSessionContext()
    const selection = await resolveAtSessionStart(
      {},
      {
        channel: { kind: 'test' },
        messages: [],
        session: {
          auth: trustedContext.session.auth,
          id: 'session-product-marketer-consultation',
        },
      }
    )
    expect(selection).toMatchObject({
      modelOptions: {
        providerOptions: {
          gateway: {
            tags: expect.arrayContaining([
              'agent:product-marketer',
              'lane:consultation',
            ]),
          },
        },
      },
    })
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

  it('maps a valid bridge token to a user principal without a role', async () => {
    const result = await authenticateBridgeToken(
      signBridgeToken(bridgeClaims())
    )
    expect(result).toEqual({
      attributes: {
        brand_id: 'brand-1',
        conversation_id: 'conversation-1',
      },
      authenticator: 'cmo-bridge',
      issuer: 'branderize-app',
      principalId: 'user-1',
      principalType: 'user',
      subject: 'user-1',
    })
  })

  it('attests an allowlisted source task in current request auth', async () => {
    const result = await authenticateBridgeToken(
      signBridgeToken(bridgeClaims({ source_task_id: SOURCE_TASK_ID }))
    )
    expect(result).toMatchObject({
      attributes: {
        brand_id: 'brand-1',
        conversation_id: 'conversation-1',
        source_task_id: SOURCE_TASK_ID,
      },
    })
    expect(
      readCurrentCmoSourceTaskId(trustedSessionContext(SOURCE_TASK_ID))
    ).toBe(SOURCE_TASK_ID)
    expect(() => readCurrentCmoSourceTaskId(trustedSessionContext())).toThrow(
      'no trusted source task'
    )
    const previousTurn = trustedSessionContext(SOURCE_TASK_ID)
    expect(() =>
      readCurrentCmoSourceTaskId({
        session: {
          ...previousTurn.session,
          auth: {
            current: previousTurn.session.auth.initiator,
            initiator: previousTurn.session.auth.current,
          },
        },
      })
    ).toThrow('no trusted source task')
  })

  it('rejects invalid bridge signatures and claims', async () => {
    const validToken = signBridgeToken(bridgeClaims())
    await expect(
      authenticateBridgeToken(
        validToken,
        'another-secret-at-least-32-characters'
      )
    ).resolves.toBeNull()
    await expect(
      authenticateBridgeToken(
        signBridgeToken(bridgeClaims({ exp: CURRENT_TIME + 61 }))
      )
    ).resolves.toBeNull()
    await expect(
      authenticateBridgeToken(signBridgeToken(bridgeClaims({ jti: '' })))
    ).resolves.toBeNull()
    await expect(
      authenticateBridgeToken(signBridgeToken(bridgeClaims({ role: 'owner' })))
    ).resolves.toBeNull()
    await expect(
      authenticateBridgeToken(
        signBridgeToken(bridgeClaims({ source_task_id: 'not-a-uuid' }))
      )
    ).resolves.toBeNull()
  })

  it('allows local development auth to continue when no bridge token exists', async () => {
    const auth = createCmoBridgeAuth({
      nowSeconds: () => CURRENT_TIME,
      readSecret: () => {
        throw new Error('missing environment')
      },
    })
    await expect(
      auth(new Request('https://agent.example/eve/v1/session'))
    ).resolves.toBeNull()
  })

  it('derives trusted tenant identity and stable requests without a call id', () => {
    const context = trustedSessionContext()
    expect(readCmoSessionIdentity(context)).toEqual({
      brandId: '00000000-0000-0000-0000-000000000201',
      conversationId: '00000000-0000-0000-0000-000000000202',
      userId: 'user-1',
    })
    const first = stableCmoRequestId({
      context,
      operation: 'refine-intent',
      semantics: { acceptanceCriteria: [{ metric: 'qualified demand' }] },
    })
    const second = stableCmoRequestId({
      context,
      operation: 'refine-intent',
      semantics: { acceptanceCriteria: [{ metric: 'qualified demand' }] },
    })
    expect(first).toBe(second)
    expect(first).toMatch(STABLE_REFINE_REQUEST_PATTERN)
  })

  it('requires matching current authentication for root and child sessions', () => {
    const trustedContext = trustedSessionContext()
    const withoutCurrent = {
      session: {
        ...trustedContext.session,
        auth: {
          current: null,
          initiator: trustedContext.session.auth.initiator,
        },
      },
    }
    expect(() => readCmoSessionIdentity(withoutCurrent)).toThrow(
      'CMO current authentication is missing'
    )
    expect(() =>
      readCmoSessionIdentity({
        session: {
          ...withoutCurrent.session,
          parent: {
            callId: 'call-1',
            rootSessionId: 'session-1',
            sessionId: 'session-1',
            turn: { id: 'turn-1', sequence: 0 },
          },
        },
      })
    ).toThrow('CMO current authentication is missing')
  })

  it('keeps tenant and target identifiers out of CMO tool inputs', () => {
    expect(
      declareIntentToolInputSchema.safeParse({
        statement: 'Grow qualified demand',
      }).success
    ).toBe(true)
    expect(
      refineIntentToolInputSchema.safeParse({
        acceptanceCriteria: [{ metric: 'qualified demand' }],
        intentId: '00000000-0000-0000-0000-000000000203',
      }).success
    ).toBe(false)
    expect(requestSpecialistWorkToolInputSchema.safeParse({}).success).toBe(
      true
    )
    expect(
      requestSpecialistWorkToolInputSchema.safeParse({
        brandId: '00000000-0000-0000-0000-000000000201',
      }).success
    ).toBe(false)
    expect(
      resolveProductMarketerQuestionsToolInputSchema.safeParse({
        disposition: 'answered',
        rationale: 'The human answered every question.',
        taskId: '00000000-0000-0000-0000-000000000204',
      }).success
    ).toBe(false)
  })

  it.each([
    {
      disposition: 'answered' as const,
      rationale: 'The human answered every question.',
    },
    {
      disposition: 'no_longer_relevant' as const,
      rationale: 'The human confirmed the questions are obsolete.',
    },
  ])('accepts the closed $disposition question disposition', (input) => {
    expect(resolveProductMarketerQuestionsToolInputSchema.parse(input)).toEqual(
      input
    )
  })

  it('rejects open or transcript-copy question resolution input', () => {
    expect(
      resolveProductMarketerQuestionsToolInputSchema.safeParse({
        disposition: 'pending',
        rationale: 'Waiting for the human.',
      }).success
    ).toBe(false)
    expect(
      resolveProductMarketerQuestionsToolInputSchema.safeParse({
        answers: ['Duplicated transcript content'],
        disposition: 'answered',
        rationale: 'The human answered every question.',
      }).success
    ).toBe(false)
  })

  it('pokes Product Marketer after a created receipt', async () => {
    const poke = vi.fn(async () => ({ outcome: 'accepted' as const }))
    const readConfiguration = vi.fn(() => ({
      endpoint: 'https://product-marketer.example.test',
      secret: DISPATCH_SECRET,
    }))

    await expect(
      attachImmediateProductMarketerDispatch({
        poke,
        readConfiguration,
        receipt: CREATED_SPECIALIST_WORK_RECEIPT,
      })
    ).resolves.toEqual({
      ...CREATED_SPECIALIST_WORK_RECEIPT,
      immediateDispatch: { outcome: 'accepted' },
    })
    expect(readConfiguration).toHaveBeenCalledOnce()
    expect(poke).toHaveBeenCalledOnce()
  })

  it('retries the payload-free poke for an exact created-receipt replay', async () => {
    const poke = vi.fn(async () => ({ outcome: 'accepted' as const }))
    const input = {
      poke,
      readConfiguration: () => ({
        endpoint: 'https://product-marketer.example.test',
        secret: DISPATCH_SECRET,
      }),
      receipt: CREATED_SPECIALIST_WORK_RECEIPT,
    } as const

    const first = await attachImmediateProductMarketerDispatch(input)
    const replay = await attachImmediateProductMarketerDispatch(input)

    expect(replay).toEqual(first)
    expect(poke).toHaveBeenCalledTimes(2)
  })

  it('does not poke for an unrelated already-active task', async () => {
    const poke = vi.fn(async () => ({ outcome: 'accepted' as const }))
    const readConfiguration = vi.fn(() => ({
      endpoint: 'https://product-marketer.example.test',
      secret: DISPATCH_SECRET,
    }))

    await expect(
      attachImmediateProductMarketerDispatch({
        poke,
        readConfiguration,
        receipt: {
          disposition: 'already_active',
          intentId: '11111111-1111-4111-8111-111111111208',
          intentRevision: 1,
          outcome: 'specialist_work_observed',
          taskId: '11111111-1111-4111-8111-111111111209',
        },
      })
    ).resolves.toMatchObject({
      immediateDispatch: { outcome: 'not_needed' },
    })
    expect(readConfiguration).not.toHaveBeenCalled()
    expect(poke).not.toHaveBeenCalled()
  })

  it('preserves the created receipt when the immediate poke fails', async () => {
    const poke = vi.fn(async () => ({
      outcome: 'deferred' as const,
      reason: 'request_failed' as const,
    }))

    await expect(
      attachImmediateProductMarketerDispatch({
        poke,
        readConfiguration: () => ({
          endpoint: 'https://product-marketer.example.test',
          secret: DISPATCH_SECRET,
        }),
        receipt: CREATED_SPECIALIST_WORK_RECEIPT,
      })
    ).resolves.toEqual({
      ...CREATED_SPECIALIST_WORK_RECEIPT,
      immediateDispatch: {
        outcome: 'deferred',
        reason: 'request_failed',
      },
    })
  })

  it('preserves the created receipt when dispatch configuration is unavailable', async () => {
    const poke = vi.fn(async () => ({ outcome: 'accepted' as const }))

    await expect(
      attachImmediateProductMarketerDispatch({
        poke,
        readConfiguration: () => {
          throw new Error(
            'AGENT_PRODUCT_MARKETER_URL=https://secret.example must not escape'
          )
        },
        receipt: CREATED_SPECIALIST_WORK_RECEIPT,
      })
    ).resolves.toEqual({
      ...CREATED_SPECIALIST_WORK_RECEIPT,
      immediateDispatch: {
        outcome: 'deferred',
        reason: 'configuration_unavailable',
      },
    })
    expect(poke).not.toHaveBeenCalled()
  })

  it('fails closed when the dispatch secret is missing or invalid', async () => {
    await expect(handler(() => undefined)(request())).resolves.toMatchObject({
      status: 503,
    })
    await expect(handler()(request({ secret: null }))).resolves.toMatchObject({
      status: 401,
    })
    await expect(
      handler()(request({ secret: 'wrong-secret-at-least-32-characters' }))
    ).resolves.toMatchObject({ status: 401 })
  })

  it('rejects selectors and every non-empty body', async () => {
    await expect(
      handler()(request({ query: '?worker=product-marketer' }))
    ).resolves.toMatchObject({ status: 400 })
    await expect(handler()(request({ body: '{}' }))).resolves.toMatchObject({
      status: 400,
    })
  })

  it('only acknowledges an authenticated payload-free poke', async () => {
    const response = await handler()(request())
    expect(response.status).toBe(202)
    await expect(response.text()).resolves.toBe('')
  })
})
