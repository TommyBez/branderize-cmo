import {
  getTaskKind,
  REGISTERED_QUESTION_TASK_KIND_KEYS,
  type RegisteredTaskCompletion,
  type RegisteredTaskKind,
  registeredTaskKindKeySchema,
} from '@repo/agents'
import type { Database } from '@repo/db/client'
import {
  actions,
  actors,
  brands,
  intents,
  objects,
  tasks,
} from '@repo/db/schema/domain'
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'

import type { MemberRole, TrustedMemberAccess } from './context'
import { fail } from './errors'
import { requireCurrentBrandMember } from './internal'
import {
  BRAND_CONTEXT_SINGLETON_KEY,
  CONTEXT_BOOTSTRAP_CLAIM_STALE_AFTER_MS,
} from './objects'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100
const pageCursorSchema = z
  .object({
    createdAt: z.date(),
    id: z.uuid(),
  })
  .strict()

const pageLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .default(DEFAULT_PAGE_SIZE)

const intentStatusSchema = z.enum(['draft', 'active', 'settled', 'abandoned'])
const objectStatusSchema = z.enum(['active', 'superseded'])

export const listBrandIntentsInputSchema = z
  .object({
    cursor: pageCursorSchema.nullable().default(null),
    limit: pageLimitSchema,
    status: intentStatusSchema.nullable().default(null),
  })
  .strict()

export const getBrandIntentInputSchema = z
  .object({ intentId: z.uuid() })
  .strict()

export const listBrandObjectsInputSchema = z
  .object({
    cursor: pageCursorSchema.nullable().default(null),
    limit: pageLimitSchema,
    status: objectStatusSchema.nullable().default(null),
    type: z.string().trim().min(1).max(160).nullable().default(null),
  })
  .strict()

export const getBrandObjectInputSchema = z
  .object({ objectId: z.uuid() })
  .strict()

const questionBundleStateSchema = z.enum(['all', 'open', 'resolved'])

export const listTaskQuestionBundlesInputSchema = z
  .object({
    cursor: pageCursorSchema.nullable().default(null),
    limit: pageLimitSchema,
    state: questionBundleStateSchema.default('open'),
  })
  .strict()

export type ListBrandIntentsInput = z.input<typeof listBrandIntentsInputSchema>
export type GetBrandIntentInput = z.input<typeof getBrandIntentInputSchema>
export type ListBrandObjectsInput = z.input<typeof listBrandObjectsInputSchema>
export type GetBrandObjectInput = z.input<typeof getBrandObjectInputSchema>
export type ListTaskQuestionBundlesInput = z.input<
  typeof listTaskQuestionBundlesInputSchema
>

export interface BrandProjection {
  readonly createdAt: Date
  readonly id: string
  readonly memberRole: MemberRole
  readonly name: string
  readonly onboardingStatus: 'incomplete' | 'importing' | 'ready'
  readonly organizationId: string
  readonly slug: string
  readonly updatedAt: Date
  readonly websiteUrl: string
}

export interface ActorProjection {
  readonly actorKey: string
  readonly id: string
  readonly type: 'human' | 'agent' | 'system'
}

export interface IntentProjection {
  readonly acceptanceCriteria: unknown
  readonly author: ActorProjection
  readonly brandId: string
  readonly constraints: unknown
  readonly createdAt: Date
  readonly id: string
  readonly parentIntentId: string | null
  readonly revision: number
  readonly statement: string
  readonly status: 'draft' | 'active' | 'settled' | 'abandoned'
  readonly updatedAt: Date
}

export interface IntentProjectionPage {
  readonly items: readonly IntentProjection[]
  readonly nextCursor: {
    readonly createdAt: Date
    readonly id: string
  } | null
}

export interface ActionProvenanceProjection {
  readonly actor: ActorProjection
  readonly createdAt: Date
  readonly effectClass: string
  readonly id: string
  readonly intentId: string | null
  readonly rationale: string
  readonly taskId: string | null
  readonly type: string
}

export type ObjectBinaryProjection =
  | { readonly kind: 'none' }
  | {
      readonly byteSize: number
      readonly contentType: string
      readonly kind: 'artifact'
      readonly sha256: string
    }

export interface ObjectProjection {
  readonly binary: ObjectBinaryProjection
  readonly brandId: string
  readonly content: unknown
  readonly contentText: string
  readonly createdAt: Date
  readonly id: string
  readonly producedBy: ActionProvenanceProjection
  readonly singletonKey: string | null
  readonly status: 'active' | 'superseded'
  readonly supersededAt: Date | null
  readonly supersededBy: string | null
  readonly type: string
}

export interface ObjectProjectionPage {
  readonly items: readonly ObjectProjection[]
  readonly nextCursor: {
    readonly createdAt: Date
    readonly id: string
  } | null
}

export type TaskQuestionResolutionProjection =
  | { readonly kind: 'open' }
  | {
      readonly actionId: string
      readonly kind: 'resolved'
      readonly resolvedAt: Date
    }

export interface TaskQuestionBundleProjection {
  readonly brandId: string
  readonly createdAt: Date
  readonly intentId: string
  readonly questions: readonly string[]
  readonly reason: string
  readonly resolution: TaskQuestionResolutionProjection
  readonly status: 'partial' | 'blocked'
  readonly summary: string
  readonly taskId: string
}

export interface TaskQuestionBundleProjectionPage {
  readonly items: readonly TaskQuestionBundleProjection[]
  readonly nextCursor: {
    readonly createdAt: Date
    readonly id: string
  } | null
}

export const projectRegisteredTaskQuestionBundle = <
  TKind extends string,
  TBrief,
  TResult,
  TCompletion extends RegisteredTaskCompletion,
>({
  task,
  taskKind,
}: {
  readonly task: {
    readonly activation: string
    readonly brandId: string
    readonly completion: unknown
    readonly createdAt: Date
    readonly executionMode: string
    readonly intentId: string | null
    readonly kind: string
    readonly payload: unknown
    readonly resolutionActionId: string | null
    readonly resolvedAt: Date | null
    readonly status: string
    readonly subjectKey: string | null
    readonly taskId: string
    readonly workerKey: string | null
  }
  readonly taskKind: RegisteredTaskKind<TKind, TBrief, TResult, TCompletion>
}): TaskQuestionBundleProjection => {
  const payload = taskKind.briefSchema.safeParse(task.payload)
  if (!payload.success) {
    return fail('invalid_task', 'Question bundle task payload is invalid')
  }
  const bindingMatches =
    task.kind === taskKind.kind &&
    task.activation === taskKind.activation &&
    task.executionMode === taskKind.executionMode &&
    task.workerKey === taskKind.workerKey &&
    task.subjectKey === taskKind.subjectKey(payload.data)
  if (!bindingMatches) {
    return fail(
      'invalid_task',
      'Question bundle task registry binding is invalid'
    )
  }
  const { completionSchema, questionPolicy } = taskKind
  const completion = completionSchema.safeParse(task.completion)
  if (
    task.status !== 'succeeded' ||
    questionPolicy === null ||
    !completion.success ||
    completion.data.status === 'completed' ||
    !questionPolicy.hasOpenQuestions(completion.data)
  ) {
    return fail('invalid_task', 'Task has no settled open-question bundle')
  }
  const openQuestions = questionPolicy.projectOpenQuestions(completion.data)
  if (
    openQuestions === null ||
    openQuestions.status !== completion.data.status
  ) {
    return fail('invalid_task', 'Task question projection is invalid')
  }
  if (task.intentId === null) {
    return fail('invalid_task', 'A question bundle requires an Intent origin')
  }
  let resolution: TaskQuestionResolutionProjection
  if (task.resolutionActionId === null && task.resolvedAt === null) {
    resolution = { kind: 'open' }
  } else if (task.resolutionActionId !== null && task.resolvedAt !== null) {
    resolution = {
      actionId: task.resolutionActionId,
      kind: 'resolved',
      resolvedAt: task.resolvedAt,
    }
  } else {
    return fail('invalid_task', 'Task question resolution is invalid')
  }
  return {
    brandId: task.brandId,
    createdAt: task.createdAt,
    intentId: task.intentId,
    questions: openQuestions.questions,
    reason: openQuestions.reason,
    resolution,
    status: openQuestions.status,
    summary: openQuestions.summary,
    taskId: task.taskId,
  }
}

export type BrandImportStatusProjection =
  | {
      readonly currentBrandContextObjectId: string | null
      readonly kind: 'incomplete'
      readonly retryAvailable: true
    }
  | {
      readonly currentBrandContextObjectId: string | null
      readonly kind: 'importing'
      readonly retryAvailable: boolean
    }
  | {
      readonly currentBrandContextObjectId: string
      readonly kind: 'ready'
      readonly retryAvailable: false
    }

export const projectBrandImportStatus = ({
  activeBrandContextObjectIds,
  contextImportClaimExpired,
  onboardingStatus,
}: {
  readonly activeBrandContextObjectIds: readonly string[]
  readonly contextImportClaimExpired: boolean
  readonly onboardingStatus: 'incomplete' | 'importing' | 'ready'
}): BrandImportStatusProjection => {
  if (activeBrandContextObjectIds.length > 1) {
    return fail(
      'invalid_output',
      'The brand has more than one active Brand Context head'
    )
  }
  const currentBrandContextObjectId = activeBrandContextObjectIds[0] ?? null

  if (onboardingStatus === 'ready') {
    if (currentBrandContextObjectId === null) {
      return fail(
        'invalid_output',
        'A ready brand must have an active Brand Context head'
      )
    }
    return {
      currentBrandContextObjectId,
      kind: 'ready',
      retryAvailable: false,
    }
  }
  if (onboardingStatus === 'importing') {
    return {
      currentBrandContextObjectId,
      kind: 'importing',
      retryAvailable: contextImportClaimExpired,
    }
  }
  return {
    currentBrandContextObjectId,
    kind: 'incomplete',
    retryAvailable: true,
  }
}

const intentProjectionSelection = {
  acceptanceCriteria: intents.acceptanceCriteria,
  authorActorKey: actors.actorKey,
  authorActorType: actors.type,
  authorId: actors.id,
  brandId: intents.brandId,
  constraints: intents.constraints,
  createdAt: intents.createdAt,
  id: intents.id,
  parentIntentId: intents.parentIntentId,
  revision: intents.revision,
  statement: intents.statement,
  status: intents.status,
  updatedAt: intents.updatedAt,
}

interface IntentProjectionRow {
  readonly acceptanceCriteria: unknown
  readonly authorActorKey: string
  readonly authorActorType: 'human' | 'agent' | 'system'
  readonly authorId: string
  readonly brandId: string
  readonly constraints: unknown
  readonly createdAt: Date
  readonly id: string
  readonly parentIntentId: string | null
  readonly revision: number
  readonly statement: string
  readonly status: 'draft' | 'active' | 'settled' | 'abandoned'
  readonly updatedAt: Date
}

const projectIntent = (row: IntentProjectionRow): IntentProjection => ({
  acceptanceCriteria: row.acceptanceCriteria,
  author: {
    actorKey: row.authorActorKey,
    id: row.authorId,
    type: row.authorActorType,
  },
  brandId: row.brandId,
  constraints: row.constraints,
  createdAt: row.createdAt,
  id: row.id,
  parentIntentId: row.parentIntentId,
  revision: row.revision,
  statement: row.statement,
  status: row.status,
  updatedAt: row.updatedAt,
})

const objectProjectionSelection = {
  actionActorId: actors.id,
  actionActorKey: actors.actorKey,
  actionActorType: actors.type,
  actionCreatedAt: actions.createdAt,
  actionEffectClass: actions.effectClass,
  actionId: actions.id,
  actionIntentId: actions.intentId,
  actionRationale: actions.rationale,
  actionTaskId: actions.taskId,
  actionType: actions.type,
  blobByteSize: objects.blobByteSize,
  blobContentType: objects.blobContentType,
  blobSha256: objects.blobSha256,
  brandId: objects.brandId,
  content: objects.content,
  contentText: objects.contentText,
  createdAt: objects.createdAt,
  id: objects.id,
  singletonKey: objects.singletonKey,
  status: objects.status,
  supersededAt: objects.supersededAt,
  supersededBy: objects.supersededBy,
  type: objects.type,
}

interface ObjectProjectionRow {
  readonly actionActorId: string
  readonly actionActorKey: string
  readonly actionActorType: 'human' | 'agent' | 'system'
  readonly actionCreatedAt: Date
  readonly actionEffectClass: string
  readonly actionId: string
  readonly actionIntentId: string | null
  readonly actionRationale: string
  readonly actionTaskId: string | null
  readonly actionType: string
  readonly blobByteSize: number | null
  readonly blobContentType: string | null
  readonly blobSha256: string | null
  readonly brandId: string
  readonly content: unknown
  readonly contentText: string
  readonly createdAt: Date
  readonly id: string
  readonly singletonKey: string | null
  readonly status: 'active' | 'superseded'
  readonly supersededAt: Date | null
  readonly supersededBy: string | null
  readonly type: string
}

const projectObjectBinary = (
  row: Pick<
    ObjectProjectionRow,
    'blobByteSize' | 'blobContentType' | 'blobSha256' | 'type'
  >
): ObjectBinaryProjection => {
  if (row.type !== 'artifact') {
    if (
      row.blobByteSize !== null ||
      row.blobContentType !== null ||
      row.blobSha256 !== null
    ) {
      return fail(
        'invalid_output',
        'A non-Artifact Object cannot expose binary metadata'
      )
    }
    return { kind: 'none' }
  }

  if (
    row.blobByteSize === null ||
    row.blobContentType === null ||
    row.blobSha256 === null
  ) {
    return fail(
      'invalid_output',
      'An Artifact Object must expose complete binary metadata'
    )
  }
  return {
    byteSize: row.blobByteSize,
    contentType: row.blobContentType,
    kind: 'artifact',
    sha256: row.blobSha256,
  }
}

const projectObject = (row: ObjectProjectionRow): ObjectProjection => ({
  binary: projectObjectBinary(row),
  brandId: row.brandId,
  content: row.content,
  contentText: row.contentText,
  createdAt: row.createdAt,
  id: row.id,
  producedBy: {
    actor: {
      actorKey: row.actionActorKey,
      id: row.actionActorId,
      type: row.actionActorType,
    },
    createdAt: row.actionCreatedAt,
    effectClass: row.actionEffectClass,
    id: row.actionId,
    intentId: row.actionIntentId,
    rationale: row.actionRationale,
    taskId: row.actionTaskId,
    type: row.actionType,
  },
  singletonKey: row.singletonKey,
  status: row.status,
  supersededAt: row.supersededAt,
  supersededBy: row.supersededBy,
  type: row.type,
})

const taskQuestionResolutionCondition = (
  state: z.infer<typeof questionBundleStateSchema>
) => {
  if (state === 'open') {
    return isNull(actions.id)
  }
  if (state === 'resolved') {
    return isNotNull(actions.id)
  }
}

export const getBrandProjection = async ({
  access,
  database,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
}): Promise<BrandProjection> =>
  await database.transaction(async (transaction) => {
    const currentMember = await requireCurrentBrandMember(transaction, access)
    const [brand] = await transaction
      .select({
        createdAt: brands.createdAt,
        id: brands.id,
        name: brands.name,
        onboardingStatus: brands.onboardingStatus,
        organizationId: brands.organizationId,
        slug: brands.slug,
        updatedAt: brands.updatedAt,
        websiteUrl: brands.websiteUrl,
      })
      .from(brands)
      .where(
        and(
          eq(brands.id, access.brandId),
          eq(brands.organizationId, access.organizationId)
        )
      )
      .limit(1)
    if (brand === undefined) {
      return fail('brand_not_found', 'The current brand no longer exists')
    }
    return { ...brand, memberRole: currentMember.role }
  })

export const listBrandIntents = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: ListBrandIntentsInput
}): Promise<IntentProjectionPage> => {
  const parsed = listBrandIntentsInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const cursorCondition =
      parsed.cursor === null
        ? undefined
        : or(
            lt(intents.createdAt, parsed.cursor.createdAt),
            and(
              eq(intents.createdAt, parsed.cursor.createdAt),
              lt(intents.id, parsed.cursor.id)
            )
          )
    const statusCondition =
      parsed.status === null ? undefined : eq(intents.status, parsed.status)
    const rows = await transaction
      .select(intentProjectionSelection)
      .from(intents)
      .innerJoin(actors, eq(actors.id, intents.authorActorId))
      .where(
        and(
          eq(intents.brandId, access.brandId),
          statusCondition,
          cursorCondition
        )
      )
      .orderBy(desc(intents.createdAt), desc(intents.id))
      .limit(parsed.limit + 1)

    const items = rows.slice(0, parsed.limit).map((row) => projectIntent(row))
    const lastItem = items.at(-1)
    const nextCursor =
      rows.length > parsed.limit && lastItem !== undefined
        ? { createdAt: lastItem.createdAt, id: lastItem.id }
        : null
    return { items, nextCursor }
  })
}

export const getBrandIntent = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: GetBrandIntentInput
}): Promise<IntentProjection | null> => {
  const parsed = getBrandIntentInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const [intent] = await transaction
      .select(intentProjectionSelection)
      .from(intents)
      .innerJoin(actors, eq(actors.id, intents.authorActorId))
      .where(
        and(
          eq(intents.brandId, access.brandId),
          eq(intents.id, parsed.intentId)
        )
      )
      .limit(1)
    return intent === undefined ? null : projectIntent(intent)
  })
}

export const listBrandObjects = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: ListBrandObjectsInput
}): Promise<ObjectProjectionPage> => {
  const parsed = listBrandObjectsInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const cursorCondition =
      parsed.cursor === null
        ? undefined
        : or(
            lt(objects.createdAt, parsed.cursor.createdAt),
            and(
              eq(objects.createdAt, parsed.cursor.createdAt),
              lt(objects.id, parsed.cursor.id)
            )
          )
    const statusCondition =
      parsed.status === null ? undefined : eq(objects.status, parsed.status)
    const typeCondition =
      parsed.type === null ? undefined : eq(objects.type, parsed.type)
    const rows = await transaction
      .select(objectProjectionSelection)
      .from(objects)
      .innerJoin(
        actions,
        and(
          eq(actions.brandId, objects.brandId),
          eq(actions.id, objects.producedBy)
        )
      )
      .innerJoin(actors, eq(actors.id, actions.actorId))
      .where(
        and(
          eq(objects.brandId, access.brandId),
          statusCondition,
          typeCondition,
          cursorCondition
        )
      )
      .orderBy(desc(objects.createdAt), desc(objects.id))
      .limit(parsed.limit + 1)

    const items = rows.slice(0, parsed.limit).map((row) => projectObject(row))
    const lastItem = items.at(-1)
    const nextCursor =
      rows.length > parsed.limit && lastItem !== undefined
        ? { createdAt: lastItem.createdAt, id: lastItem.id }
        : null
    return { items, nextCursor }
  })
}

export const getBrandObject = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: GetBrandObjectInput
}): Promise<ObjectProjection | null> => {
  const parsed = getBrandObjectInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const [object] = await transaction
      .select(objectProjectionSelection)
      .from(objects)
      .innerJoin(
        actions,
        and(
          eq(actions.brandId, objects.brandId),
          eq(actions.id, objects.producedBy)
        )
      )
      .innerJoin(actors, eq(actors.id, actions.actorId))
      .where(
        and(
          eq(objects.brandId, access.brandId),
          eq(objects.id, parsed.objectId)
        )
      )
      .limit(1)
    return object === undefined ? null : projectObject(object)
  })
}

export const listTaskQuestionBundles = async ({
  access,
  database,
  input,
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly input: ListTaskQuestionBundlesInput
}): Promise<TaskQuestionBundleProjectionPage> => {
  const parsed = listTaskQuestionBundlesInputSchema.parse(input)

  return await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const cursorCondition =
      parsed.cursor === null
        ? undefined
        : or(
            lt(tasks.createdAt, parsed.cursor.createdAt),
            and(
              eq(tasks.createdAt, parsed.cursor.createdAt),
              lt(tasks.id, parsed.cursor.id)
            )
          )
    const resolutionCondition = taskQuestionResolutionCondition(parsed.state)
    const rows = await transaction
      .select({
        activation: tasks.activation,
        brandId: tasks.brandId,
        completion: tasks.completion,
        createdAt: tasks.createdAt,
        executionMode: tasks.executionMode,
        intentId: tasks.intentId,
        kind: tasks.kind,
        payload: tasks.payload,
        resolutionActionId: actions.id,
        resolvedAt: actions.createdAt,
        status: tasks.status,
        subjectKey: tasks.subjectKey,
        taskId: tasks.id,
        workerKey: tasks.workerKey,
      })
      .from(tasks)
      .leftJoin(
        actions,
        and(
          eq(actions.brandId, tasks.brandId),
          eq(actions.taskId, tasks.id),
          eq(actions.type, 'task_questions_resolved')
        )
      )
      .where(
        and(
          eq(tasks.brandId, access.brandId),
          inArray(tasks.kind, [...REGISTERED_QUESTION_TASK_KIND_KEYS]),
          eq(tasks.status, 'succeeded'),
          sql<boolean>`${tasks.completion}->>'status' IN ('partial', 'blocked')`,
          resolutionCondition,
          cursorCondition
        )
      )
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(parsed.limit + 1)

    const pageRows = rows.slice(0, parsed.limit)
    const items = pageRows.map((row): TaskQuestionBundleProjection => {
      const registeredKind = registeredTaskKindKeySchema.safeParse(row.kind)
      if (!registeredKind.success) {
        return fail(
          'invalid_task',
          'Question bundle task kind is not registered'
        )
      }
      return projectRegisteredTaskQuestionBundle({
        task: row,
        taskKind: getTaskKind(registeredKind.data),
      })
    })
    const lastItem = items.at(-1)
    const nextCursor =
      rows.length > parsed.limit && lastItem !== undefined
        ? { createdAt: lastItem.createdAt, id: lastItem.taskId }
        : null
    return { items, nextCursor }
  })
}

export const getBrandImportStatus = async ({
  access,
  database,
  now = new Date(),
}: {
  readonly access: TrustedMemberAccess
  readonly database: Database
  readonly now?: Date
}): Promise<BrandImportStatusProjection> =>
  await database.transaction(async (transaction) => {
    await requireCurrentBrandMember(transaction, access)
    const [brand] = await transaction
      .select({
        onboardingStatus: brands.onboardingStatus,
        updatedAt: brands.updatedAt,
      })
      .from(brands)
      .where(
        and(
          eq(brands.id, access.brandId),
          eq(brands.organizationId, access.organizationId)
        )
      )
      .limit(1)
    if (brand === undefined) {
      return fail('brand_not_found', 'The current brand no longer exists')
    }

    const activeContexts = await transaction
      .select({ id: objects.id })
      .from(objects)
      .where(
        and(
          eq(objects.brandId, access.brandId),
          eq(objects.type, 'brand_context'),
          eq(objects.singletonKey, BRAND_CONTEXT_SINGLETON_KEY),
          eq(objects.status, 'active')
        )
      )
      .limit(2)
    return projectBrandImportStatus({
      activeBrandContextObjectIds: activeContexts.map(({ id }) => id),
      contextImportClaimExpired:
        brand.onboardingStatus === 'importing' &&
        now.getTime() - brand.updatedAt.getTime() >=
          CONTEXT_BOOTSTRAP_CLAIM_STALE_AFTER_MS,
      onboardingStatus: brand.onboardingStatus,
    })
  })
