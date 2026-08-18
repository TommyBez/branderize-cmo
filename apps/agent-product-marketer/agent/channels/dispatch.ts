import {
  createPayloadFreeDispatchHandler,
  type DispatchSecretDependencies,
} from '@repo/agents/dispatch-handler'
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

export interface DispatchHandlerDependencies
  extends DispatchSecretDependencies {
  readonly drain: (from: ChannelFrom) => Promise<void>
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
    const [
      {
        adaptProductMarketerClaim,
        claimRegisteredAgentTask,
        prepareProductMarketerClaim,
        PRODUCT_MARKETER_TASK_KIND,
      },
      { db },
    ] = await Promise.all([import('@repo/brain/tasks'), import('@repo/db')])
    const claim = await claimRegisteredAgentTask({
      database: db,
      kind: PRODUCT_MARKETER_TASK_KIND,
      now,
      prepareAdapterContext: prepareProductMarketerClaim,
    })
    return claim === null ? null : adaptProductMarketerClaim(claim)
  },
  failDelivery: async ({ claim, now }) => {
    const [{ failRegisteredAgentDelivery }, { db }] = await Promise.all([
      import('@repo/brain/tasks'),
      import('@repo/db'),
    ])
    await failRegisteredAgentDelivery({ claim, database: db, now })
  },
  now: () => new Date(),
})

const productionDrain = async (from: ChannelFrom): Promise<void> => {
  await drainProductMarketerTasks({
    dependencies: productionDrainDependencies(),
    from,
  })
}

type ProductMarketerDispatchRoute = Pick<RouteHandlerArgs, 'from' | 'waitUntil'>

export const createDispatchHandler = ({
  drain,
  readSecret,
}: DispatchHandlerDependencies): ((
  request: Request,
  route: ProductMarketerDispatchRoute
) => Promise<Response>) =>
  createPayloadFreeDispatchHandler<ProductMarketerDispatchRoute>({
    onAccepted: (route) => {
      const backgroundDrain = Promise.resolve().then(() => drain(route.from))
      route.waitUntil(backgroundDrain)
    },
    readSecret,
  })

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
