import { createHash, timingSafeEqual } from 'node:crypto'

import { productMarketerCompletionSchema } from '@repo/agents/tasks'
import type { ClaimedProductMarketerTask } from '@repo/brain/tasks'
import { parseAgentServerEnvironment } from '@repo/env/agent-server'
import {
  type ChannelFrom,
  defineChannel,
  POST,
  type RouteHandlerArgs,
} from 'eve/channels'
import { z } from 'zod'

import { ROOT_RUNTIME_CONTRACT } from '../lib/root-contract'
import {
  buildProductMarketerPrompt,
  createProductMarketerSessionAuth,
  productMarketerTaskAddress,
  taskExecutionFromClaim,
} from '../lib/task-runtime'

const MINIMUM_SECRET_LENGTH = 32
const BEARER_SCHEME = 'bearer'
const NO_STORE_HEADERS = { 'cache-control': 'no-store' } as const
const MAXIMUM_TASKS_PER_DISPATCH = 5

const jsonObjectSchema = z.record(z.string(), z.json())

export const PRODUCT_MARKETER_COMPLETION_OUTPUT_SCHEMA = jsonObjectSchema.parse(
  z.toJSONSchema(productMarketerCompletionSchema)
)

export interface ProductMarketerDrainDependencies {
  readonly bindSession: (input: {
    readonly claim: ClaimedProductMarketerTask
    readonly sessionId: string
  }) => Promise<void>
  readonly claimTask: (now: Date) => Promise<ClaimedProductMarketerTask | null>
  readonly failDelivery: (input: {
    readonly claim: ClaimedProductMarketerTask
    readonly now: Date
  }) => Promise<void>
  readonly now: () => Date
}

export interface DispatchHandlerDependencies {
  readonly drain: (from: ChannelFrom) => Promise<void>
  readonly readSecret: () => string | undefined
}

const jsonError = (status: number, code: string): Response =>
  Response.json(
    { code, ok: false },
    {
      headers: NO_STORE_HEADERS,
      status,
    }
  )

const parseBearerToken = (authorization: string | null): string | null => {
  if (authorization === null) {
    return null
  }

  const separatorIndex = authorization.indexOf(' ')
  if (separatorIndex < 1) {
    return null
  }

  const scheme = authorization.slice(0, separatorIndex).toLowerCase()
  const token = authorization.slice(separatorIndex + 1)
  if (
    scheme !== BEARER_SCHEME ||
    token.length === 0 ||
    token.trim() !== token ||
    token.includes(' ')
  ) {
    return null
  }

  return token
}

const secretsMatch = (provided: string, configured: string): boolean => {
  const providedDigest = createHash('sha256').update(provided).digest()
  const configuredDigest = createHash('sha256').update(configured).digest()
  return timingSafeEqual(providedDigest, configuredDigest)
}

const drainNextProductMarketerTask = async ({
  dependencies,
  from,
  remaining,
}: {
  readonly dependencies: ProductMarketerDrainDependencies
  readonly from: ChannelFrom
  readonly remaining: number
}): Promise<void> => {
  if (remaining === 0) {
    return
  }

  const claim = await dependencies.claimTask(dependencies.now())
  if (claim === null) {
    return
  }

  let sessionId: string
  try {
    const session = await from(productMarketerTaskAddress(claim)).send(
      buildProductMarketerPrompt(claim),
      {
        auth: createProductMarketerSessionAuth(claim),
        mode: 'task',
        outputSchema: PRODUCT_MARKETER_COMPLETION_OUTPUT_SCHEMA,
        title: `Product Marketer task ${claim.taskId}`,
      }
    )
    sessionId = session.id
  } catch (error) {
    await dependencies.failDelivery({
      claim,
      now: dependencies.now(),
    })
    throw error
  }

  await dependencies.bindSession({ claim, sessionId })
  await drainNextProductMarketerTask({
    dependencies,
    from,
    remaining: remaining - 1,
  })
}

export const drainProductMarketerTasks = async ({
  dependencies,
  from,
  limit = MAXIMUM_TASKS_PER_DISPATCH,
}: {
  readonly dependencies: ProductMarketerDrainDependencies
  readonly from: ChannelFrom
  readonly limit?: number
}): Promise<void> => {
  if (!(Number.isInteger(limit) && limit > 0)) {
    throw new Error('Product Marketer drain limit must be a positive integer')
  }

  await drainNextProductMarketerTask({ dependencies, from, remaining: limit })
}

const productionDrainDependencies = (): ProductMarketerDrainDependencies => ({
  bindSession: async ({ claim, sessionId }) => {
    const [{ bindTaskSession }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    await bindTaskSession({
      database: db,
      execution: taskExecutionFromClaim({ claim, sessionId }),
    })
  },
  claimTask: async (now) => {
    const [{ claimProductMarketerTask }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    return await claimProductMarketerTask({ database: db, now })
  },
  failDelivery: async ({ claim, now }) => {
    const [{ failProductMarketerDelivery }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    await failProductMarketerDelivery({ claim, database: db, now })
  },
  now: () => new Date(),
})

const productionDrain = async (from: ChannelFrom): Promise<void> => {
  await drainProductMarketerTasks({
    dependencies: productionDrainDependencies(),
    from,
  })
}

export const createDispatchHandler =
  ({
    drain,
    readSecret,
  }: DispatchHandlerDependencies): ((
    request: Request,
    route: Pick<RouteHandlerArgs, 'from' | 'waitUntil'>
  ) => Promise<Response>) =>
  async (
    request: Request,
    route: Pick<RouteHandlerArgs, 'from' | 'waitUntil'>
  ): Promise<Response> => {
    const configuredSecret = readSecret()
    if (
      configuredSecret === undefined ||
      configuredSecret.length < MINIMUM_SECRET_LENGTH
    ) {
      return jsonError(503, 'dispatch_unavailable')
    }

    const providedSecret = parseBearerToken(
      request.headers.get('authorization')
    )
    if (
      providedSecret === null ||
      !secretsMatch(providedSecret, configuredSecret)
    ) {
      const response = jsonError(401, 'unauthorized')
      response.headers.set('www-authenticate', 'Bearer')
      return response
    }

    if (new URL(request.url).search.length > 0) {
      return jsonError(400, 'selectors_not_allowed')
    }

    if ((await request.arrayBuffer()).byteLength > 0) {
      return jsonError(400, 'payload_not_allowed')
    }

    const backgroundDrain = Promise.resolve().then(() => drain(route.from))
    route.waitUntil(backgroundDrain)

    return new Response(null, {
      headers: NO_STORE_HEADERS,
      status: 202,
    })
  }

export const handleDispatchRequest = createDispatchHandler({
  drain: productionDrain,
  readSecret: () => {
    try {
      return parseAgentServerEnvironment(process.env).DISPATCH_SECRET
    } catch {
      // Invalid runtime configuration keeps dispatch closed.
    }
  },
})

export default defineChannel({
  routes: [
    POST(ROOT_RUNTIME_CONTRACT.dispatch.path, async (request, route) =>
      handleDispatchRequest(request, route)
    ),
  ],
})
