import { type SQL, sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: 'date', withTimezone: true })

const tsVector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const actorType = pgEnum('actor_type', ['human', 'agent', 'system'])
export const intentStatus = pgEnum('intent_status', [
  'draft',
  'active',
  'settled',
  'abandoned',
])
export const objectStatus = pgEnum('object_status', ['active', 'superseded'])
export const executionMode = pgEnum('execution_mode', ['agent', 'direct'])
export const taskActivation = pgEnum('task_activation', ['automatic', 'human'])
export const taskStatus = pgEnum('task_status', [
  'awaiting_approval',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
  'outcome_unknown',
  'expired',
  'needs_regeneration',
  'dismissed',
])
export const ledgerEntryType = pgEnum('ledger_entry_type', [
  'grant',
  'model_charge',
  'action_charge',
])
export const scheduleCadence = pgEnum('schedule_cadence', ['daily', 'weekly'])
export const brandOnboardingStatus = pgEnum('brand_onboarding_status', [
  'incomplete',
  'importing',
  'ready',
])

export const brands = pgTable(
  'brands',
  {
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    onboardingStatus: brandOnboardingStatus('onboarding_status')
      .default('incomplete')
      .notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    updatedAt: timestampWithTimezone('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    websiteUrl: text('website_url').notNull(),
  },
  (table) => [
    unique('brands_organization_slug_unique').on(
      table.organizationId,
      table.slug
    ),
    index('brands_organization_id_idx').on(table.organizationId),
    check('brands_name_nonempty', sql`length(btrim(${table.name})) > 0`),
    check(
      'brands_website_url_nonempty',
      sql`length(btrim(${table.websiteUrl})) > 0`
    ),
  ]
)

export const actors = pgTable(
  'actors',
  {
    actorKey: text('actor_key').notNull(),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    id: uuid('id').defaultRandom().primaryKey(),
    type: actorType('type').notNull(),
    userId: text('user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    unique('actors_actor_key_unique').on(table.actorKey),
    unique('actors_user_id_unique').on(table.userId),
    check(
      'actors_human_user_consistency',
      sql`(${table.type} = 'human') = (${table.userId} IS NOT NULL)`
    ),
    check(
      'actors_human_key_consistency',
      sql`${table.type} <> 'human' OR ${table.actorKey} = 'human:' || ${table.userId}`
    ),
    check('actors_key_nonempty', sql`length(btrim(${table.actorKey})) > 0`),
  ]
)

export const intents = pgTable(
  'intents',
  {
    acceptanceCriteria: jsonb('acceptance_criteria'),
    authorActorId: uuid('author_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    constraints: jsonb('constraints'),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    id: uuid('id').defaultRandom().primaryKey(),
    parentIntentId: uuid('parent_intent_id'),
    revision: integer('revision').default(1).notNull(),
    statement: text('statement').notNull(),
    status: intentStatus('status').notNull(),
    updatedAt: timestampWithTimezone('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('intents_brand_id_id_unique').on(table.brandId, table.id),
    foreignKey({
      columns: [table.brandId, table.parentIntentId],
      foreignColumns: [table.brandId, table.id],
      name: 'intents_parent_same_brand_fk',
    }),
    index('intents_brand_status_created_idx').on(
      table.brandId,
      table.status,
      table.createdAt
    ),
    check('intents_revision_positive', sql`${table.revision} > 0`),
    check(
      'intents_statement_nonempty',
      sql`length(btrim(${table.statement})) > 0`
    ),
    check(
      'intents_acceptance_criteria_nonempty_array',
      sql`${table.acceptanceCriteria} IS NULL OR (jsonb_typeof(${table.acceptanceCriteria}) = 'array' AND jsonb_array_length(${table.acceptanceCriteria}) > 0)`
    ),
    check(
      'intents_constraints_nonempty_array',
      sql`${table.constraints} IS NULL OR (jsonb_typeof(${table.constraints}) = 'array' AND jsonb_array_length(${table.constraints}) > 0)`
    ),
    check(
      'intents_constraints_require_criteria',
      sql`${table.constraints} IS NULL OR ${table.acceptanceCriteria} IS NOT NULL`
    ),
    check(
      'intents_parent_not_self',
      sql`${table.parentIntentId} IS NULL OR ${table.parentIntentId} <> ${table.id}`
    ),
  ]
)

export const actions = pgTable(
  'actions',
  {
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    callId: text('call_id'),
    conversationId: uuid('conversation_id'),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    decisionId: uuid('decision_id'),
    effectClass: text('effect_class').notNull(),
    id: uuid('id').defaultRandom().primaryKey(),
    intentId: uuid('intent_id'),
    operationKey: text('operation_key'),
    payload: jsonb('payload').notNull(),
    policySnapshot: jsonb('policy_snapshot').notNull(),
    rationale: text('rationale').notNull(),
    requestHash: text('request_hash'),
    scheduleId: uuid('schedule_id'),
    sessionId: text('session_id'),
    taskId: uuid('task_id'),
    turnId: text('turn_id'),
    type: text('type').notNull(),
  },
  (table) => [
    unique('actions_brand_id_id_unique').on(table.brandId, table.id),
    foreignKey({
      columns: [table.brandId, table.intentId],
      foreignColumns: [intents.brandId, intents.id],
      name: 'actions_intent_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.conversationId, table.sessionId],
      foreignColumns: [
        cmoConversations.brandId,
        cmoConversations.id,
        cmoConversations.sessionId,
      ],
      name: 'actions_conversation_same_brand_session_fk',
    }),
    uniqueIndex('actions_brand_operation_key_unique')
      .on(table.brandId, table.operationKey)
      .where(sql`${table.operationKey} IS NOT NULL`),
    uniqueIndex('actions_task_questions_resolved_unique')
      .on(table.taskId)
      .where(sql`${table.type} = 'task_questions_resolved'`),
    index('actions_brand_created_idx').on(table.brandId, table.createdAt),
    index('actions_brand_conversation_created_idx')
      .on(table.brandId, table.conversationId, table.createdAt, table.id)
      .where(sql`${table.conversationId} IS NOT NULL`),
    index('actions_brand_conversation_session_turn_idx')
      .on(
        table.brandId,
        table.conversationId,
        table.sessionId,
        table.turnId,
        table.createdAt,
        table.id
      )
      .where(sql`${table.turnId} IS NOT NULL`),
    index('actions_intent_id_idx').on(table.intentId),
    index('actions_task_id_idx').on(table.taskId),
    check(
      'actions_operation_receipt_pair',
      sql`(${table.operationKey} IS NULL) = (${table.requestHash} IS NULL)`
    ),
    check(
      'actions_conversation_turn_pair',
      sql`(${table.conversationId} IS NULL) = (${table.turnId} IS NULL)`
    ),
    check(
      'actions_turn_requires_session',
      sql`${table.turnId} IS NULL OR ${table.sessionId} IS NOT NULL`
    ),
    check(
      'actions_payload_object',
      sql`jsonb_typeof(${table.payload}) = 'object'`
    ),
    check(
      'actions_policy_snapshot_object',
      sql`jsonb_typeof(${table.policySnapshot}) = 'object'`
    ),
    check(
      'actions_effect_class_nonempty',
      sql`length(btrim(${table.effectClass})) > 0`
    ),
    check(
      'actions_rationale_nonempty',
      sql`length(btrim(${table.rationale})) > 0`
    ),
    check('actions_type_nonempty', sql`length(btrim(${table.type})) > 0`),
  ]
)

export const objects = pgTable(
  'objects',
  {
    blobByteSize: bigint('blob_byte_size', { mode: 'number' }),
    blobContentType: text('blob_content_type'),
    blobKey: text('blob_key'),
    blobSha256: text('blob_sha256'),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    content: jsonb('content').notNull(),
    contentText: text('content_text').notNull(),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    id: uuid('id').defaultRandom().primaryKey(),
    producedBy: uuid('produced_by').notNull(),
    searchVector: tsVector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`to_tsvector('simple', coalesce(${objects.contentText}, ''))`
      ),
    singletonKey: text('singleton_key'),
    status: objectStatus('status').default('active').notNull(),
    supersededAt: timestampWithTimezone('superseded_at'),
    supersededBy: uuid('superseded_by'),
    type: text('type').notNull(),
  },
  (table) => [
    unique('objects_brand_id_id_unique').on(table.brandId, table.id),
    foreignKey({
      columns: [table.brandId, table.producedBy],
      foreignColumns: [actions.brandId, actions.id],
      name: 'objects_produced_by_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.supersededBy],
      foreignColumns: [table.brandId, table.id],
      name: 'objects_superseded_by_same_brand_fk',
    }),
    uniqueIndex('objects_singleton_active_unique')
      .on(table.brandId, table.singletonKey)
      .where(
        sql`${table.status} = 'active' AND ${table.singletonKey} IS NOT NULL`
      ),
    uniqueIndex('objects_blob_key_unique')
      .on(table.blobKey)
      .where(sql`${table.blobKey} IS NOT NULL`),
    index('objects_brand_type_status_idx').on(
      table.brandId,
      table.type,
      table.status
    ),
    index('objects_search_vector_idx').using('gin', table.searchVector),
    check(
      'objects_content_object',
      sql`jsonb_typeof(${table.content}) = 'object'`
    ),
    check('objects_type_nonempty', sql`length(btrim(${table.type})) > 0`),
    check(
      'objects_supersession_consistency',
      sql`(${table.status} = 'active' AND ${table.supersededBy} IS NULL AND ${table.supersededAt} IS NULL) OR (${table.status} = 'superseded' AND ${table.supersededBy} IS NOT NULL AND ${table.supersededAt} IS NOT NULL)`
    ),
    check(
      'objects_not_self_superseded',
      sql`${table.supersededBy} IS NULL OR ${table.supersededBy} <> ${table.id}`
    ),
    check(
      'objects_artifact_blob_consistency',
      sql`(${table.type} = 'artifact' AND ${table.blobKey} IS NOT NULL AND ${table.blobSha256} IS NOT NULL AND ${table.blobContentType} IS NOT NULL AND ${table.blobByteSize} IS NOT NULL AND ${table.blobByteSize} > 0 AND ${table.blobSha256} ~ '^[0-9a-f]{64}$' AND position(${table.brandId}::text in ${table.blobKey}) > 0 AND position(${table.blobSha256} in ${table.blobKey}) > 0) OR (${table.type} <> 'artifact' AND ${table.blobKey} IS NULL AND ${table.blobSha256} IS NULL AND ${table.blobContentType} IS NULL AND ${table.blobByteSize} IS NULL)`
    ),
  ]
)

export const cmoConversations = pgTable(
  'cmo_conversations',
  {
    archivedAt: timestampWithTimezone('archived_at'),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    sessionId: text('session_id'),
    streamIndex: bigint('stream_index', { mode: 'number' })
      .default(0)
      .notNull(),
    title: text('title'),
    updatedAt: timestampWithTimezone('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('cmo_conversations_brand_id_id_unique').on(table.brandId, table.id),
    unique('cmo_conversations_brand_id_id_session_id_unique').on(
      table.brandId,
      table.id,
      table.sessionId
    ),
    uniqueIndex('cmo_conversations_session_id_unique')
      .on(table.sessionId)
      .where(sql`${table.sessionId} IS NOT NULL`),
    index('cmo_conversations_owner_brand_created_idx').on(
      table.ownerUserId,
      table.brandId,
      table.createdAt
    ),
    check(
      'cmo_conversations_stream_index_nonnegative',
      sql`${table.streamIndex} >= 0`
    ),
  ]
)

export const schedules = pgTable(
  'schedules',
  {
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    cadence: scheduleCadence('cadence'),
    coalescedDueCount: bigint('coalesced_due_count', { mode: 'number' })
      .default(0)
      .notNull(),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    enabled: boolean('enabled').default(false).notNull(),
    fixedPayload: jsonb('fixed_payload').notNull(),
    id: uuid('id').defaultRandom().primaryKey(),
    kind: text('kind').notNull(),
    lastCoalescedFor: timestampWithTimezone('last_coalesced_for'),
    localTime: time('local_time'),
    localWeekday: smallint('local_weekday'),
    nextScheduledFor: timestampWithTimezone('next_scheduled_for'),
    payloadDigest: text('payload_digest').notNull(),
    revision: integer('revision').default(1).notNull(),
    scheduleKey: text('schedule_key').notNull(),
    timeZone: text('time_zone'),
    updatedAt: timestampWithTimezone('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    workerKey: text('worker_key').notNull(),
  },
  (table) => [
    unique('schedules_brand_id_id_unique').on(table.brandId, table.id),
    unique('schedules_brand_key_unique').on(table.brandId, table.scheduleKey),
    index('schedules_due_worker_idx').on(
      table.workerKey,
      table.nextScheduledFor
    ),
    check('schedules_revision_positive', sql`${table.revision} > 0`),
    check(
      'schedules_coalesced_due_count_nonnegative',
      sql`${table.coalescedDueCount} >= 0`
    ),
    check(
      'schedules_coalescing_consistency',
      sql`(${table.coalescedDueCount} = 0) = (${table.lastCoalescedFor} IS NULL)`
    ),
    check(
      'schedules_fixed_payload_object',
      sql`jsonb_typeof(${table.fixedPayload}) = 'object'`
    ),
    check(
      'schedules_calendar_shape',
      sql`(${table.cadence} IS NULL AND ${table.localTime} IS NULL AND ${table.localWeekday} IS NULL) OR (${table.cadence} = 'daily' AND ${table.localTime} IS NOT NULL AND ${table.localWeekday} IS NULL) OR (${table.cadence} = 'weekly' AND ${table.localTime} IS NOT NULL AND ${table.localWeekday} BETWEEN 0 AND 6)`
    ),
    check(
      'schedules_enabled_configuration',
      sql`NOT ${table.enabled} OR (${table.cadence} IS NOT NULL AND ${table.localTime} IS NOT NULL AND ${table.timeZone} IS NOT NULL AND length(btrim(${table.timeZone})) > 0 AND ${table.nextScheduledFor} IS NOT NULL)`
    ),
  ]
)

export const tasks = pgTable(
  'tasks',
  {
    activation: taskActivation('activation').notNull(),
    approvalActionId: uuid('approval_action_id'),
    approvedAt: timestampWithTimezone('approved_at'),
    attempts: integer('attempts').default(0).notNull(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    commitmentConflictKey: text('commitment_conflict_key'),
    completion: jsonb('completion'),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    creationHash: text('creation_hash'),
    dueAt: timestampWithTimezone('due_at').defaultNow().notNull(),
    executeBefore: timestampWithTimezone('execute_before'),
    executionMode: executionMode('execution_mode').notNull(),
    finishedAt: timestampWithTimezone('finished_at'),
    id: uuid('id').defaultRandom().primaryKey(),
    idempotencyKey: text('idempotency_key'),
    intentId: uuid('intent_id'),
    intentSnapshot: jsonb('intent_snapshot'),
    kind: text('kind').notNull(),
    leasedUntil: timestampWithTimezone('leased_until'),
    moveCandidateId: uuid('move_candidate_id'),
    nextDueAt: timestampWithTimezone('next_due_at'),
    nextPayload: jsonb('next_payload'),
    nextRationale: text('next_rationale'),
    outcomeCode: text('outcome_code'),
    parentTaskId: uuid('parent_task_id'),
    payload: jsonb('payload').notNull(),
    payloadHash: text('payload_hash').notNull(),
    planObjectId: uuid('plan_object_id'),
    resultActionId: uuid('result_action_id'),
    retryOfTaskId: uuid('retry_of_task_id'),
    revision: integer('revision').default(1).notNull(),
    scheduledFor: timestampWithTimezone('scheduled_for'),
    scheduleId: uuid('schedule_id'),
    sessionId: text('session_id'),
    startedAt: timestampWithTimezone('started_at'),
    status: taskStatus('status').notNull(),
    subjectKey: text('subject_key').notNull(),
    supersedesTaskId: uuid('supersedes_task_id'),
    updatedAt: timestampWithTimezone('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    workerKey: text('worker_key').notNull(),
  },
  (table) => [
    unique('tasks_brand_id_id_unique').on(table.brandId, table.id),
    foreignKey({
      columns: [table.brandId, table.intentId],
      foreignColumns: [intents.brandId, intents.id],
      name: 'tasks_intent_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.planObjectId],
      foreignColumns: [objects.brandId, objects.id],
      name: 'tasks_plan_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.moveCandidateId],
      foreignColumns: [objects.brandId, objects.id],
      name: 'tasks_move_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.parentTaskId],
      foreignColumns: [table.brandId, table.id],
      name: 'tasks_parent_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.retryOfTaskId],
      foreignColumns: [table.brandId, table.id],
      name: 'tasks_retry_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.supersedesTaskId],
      foreignColumns: [table.brandId, table.id],
      name: 'tasks_supersedes_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.scheduleId],
      foreignColumns: [schedules.brandId, schedules.id],
      name: 'tasks_schedule_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.approvalActionId],
      foreignColumns: [actions.brandId, actions.id],
      name: 'tasks_approval_action_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.resultActionId],
      foreignColumns: [actions.brandId, actions.id],
      name: 'tasks_result_action_same_brand_fk',
    }),
    uniqueIndex('tasks_active_identity_unique')
      .on(table.kind, table.brandId, table.subjectKey)
      .where(
        sql`${table.status} IN ('awaiting_approval', 'queued', 'running')`
      ),
    uniqueIndex('tasks_idempotency_key_unique')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex('tasks_session_id_unique')
      .on(table.sessionId)
      .where(sql`${table.sessionId} IS NOT NULL`),
    uniqueIndex('tasks_schedule_slot_unique')
      .on(table.scheduleId, table.scheduledFor)
      .where(sql`${table.scheduleId} IS NOT NULL`),
    uniqueIndex('tasks_active_schedule_unique')
      .on(table.scheduleId)
      .where(
        sql`${table.scheduleId} IS NOT NULL AND ${table.status} IN ('queued', 'running')`
      ),
    uniqueIndex('tasks_active_commitment_conflict_unique')
      .on(table.brandId, table.commitmentConflictKey)
      .where(
        sql`${table.activation} = 'human' AND ${table.status} IN ('queued', 'running') AND ${table.commitmentConflictKey} IS NOT NULL`
      ),
    index('tasks_agent_claim_idx')
      .on(table.workerKey, table.createdAt, table.id)
      .where(
        sql`${table.executionMode} = 'agent' AND ${table.activation} = 'automatic' AND ${table.status} = 'queued'`
      ),
    index('tasks_direct_automatic_claim_idx')
      .on(table.workerKey, table.createdAt, table.id)
      .where(
        sql`${table.executionMode} = 'direct' AND ${table.activation} = 'automatic' AND ${table.status} IN ('queued', 'running')`
      ),
    index('tasks_human_commitment_claim_idx')
      .on(table.workerKey, table.executeBefore, table.approvedAt, table.id)
      .where(
        sql`${table.executionMode} = 'direct' AND ${table.activation} = 'human' AND ${table.status} = 'queued'`
      ),
    check('tasks_revision_positive', sql`${table.revision} > 0`),
    check('tasks_attempts_nonnegative', sql`${table.attempts} >= 0`),
    check(
      'tasks_creator_receipt_pair',
      sql`(${table.idempotencyKey} IS NULL) = (${table.creationHash} IS NULL)`
    ),
    check(
      'tasks_mode_activation_valid',
      sql`(${table.executionMode} = 'agent' AND ${table.activation} = 'automatic') OR ${table.executionMode} = 'direct'`
    ),
    check(
      'tasks_status_mode_valid',
      sql`(${table.executionMode} = 'agent' AND ${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'superseded')) OR (${table.executionMode} = 'direct' AND ${table.activation} = 'automatic' AND ${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')) OR (${table.executionMode} = 'direct' AND ${table.activation} = 'human' AND ${table.status} IN ('awaiting_approval', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown', 'expired', 'needs_regeneration', 'dismissed', 'superseded'))`
    ),
    check(
      'tasks_finished_at_status_consistency',
      sql`(${table.status} IN ('awaiting_approval', 'queued', 'running') AND ${table.finishedAt} IS NULL) OR (${table.status} NOT IN ('awaiting_approval', 'queued', 'running') AND ${table.finishedAt} IS NOT NULL)`
    ),
    check(
      'tasks_started_at_status_consistency',
      sql`(${table.status} = 'running' AND ${table.startedAt} IS NOT NULL) OR (${table.status} IN ('awaiting_approval', 'queued') AND ${table.startedAt} IS NULL) OR ${table.status} NOT IN ('awaiting_approval', 'queued', 'running')`
    ),
    check(
      'tasks_agent_runtime_fields',
      sql`${table.executionMode} <> 'agent' OR (${table.attempts} = 0 AND ${table.leasedUntil} IS NULL)`
    ),
    check(
      'tasks_direct_runtime_fields',
      sql`${table.executionMode} <> 'direct' OR (${table.sessionId} IS NULL AND ${table.completion} IS NULL)`
    ),
    check(
      'tasks_human_runtime_fields',
      sql`${table.activation} <> 'human' OR (${table.attempts} = 0 AND ${table.leasedUntil} IS NULL AND ${table.sessionId} IS NULL AND ${table.completion} IS NULL AND ${table.nextDueAt} IS NULL AND ${table.nextPayload} IS NULL AND ${table.nextRationale} IS NULL)`
    ),
    check(
      'tasks_terminal_without_lease',
      sql`${table.finishedAt} IS NULL OR ${table.leasedUntil} IS NULL`
    ),
    check(
      'tasks_completion_shape',
      sql`${table.completion} IS NULL OR (jsonb_typeof(${table.completion}) = 'object' AND ${table.completion}->>'status' IN ('completed', 'partial', 'blocked'))`
    ),
    check(
      'tasks_completion_status_consistency',
      sql`${table.executionMode} <> 'agent' OR (${table.status} = 'succeeded' AND ${table.completion} IS NOT NULL) OR (${table.status} = 'running') OR (${table.status} IN ('queued', 'failed', 'cancelled', 'superseded') AND ${table.completion} IS NULL)`
    ),
    check(
      'tasks_queued_agent_unbound',
      sql`NOT (${table.executionMode} = 'agent' AND ${table.status} = 'queued') OR ${table.sessionId} IS NULL`
    ),
    check(
      'tasks_next_tuple_consistency',
      sql`num_nonnulls(${table.nextDueAt}, ${table.nextPayload}, ${table.nextRationale}) IN (0, 3) AND (${table.nextDueAt} IS NULL OR (${table.status} = 'running' AND jsonb_typeof(${table.nextPayload}) = 'object'))`
    ),
    check(
      'tasks_intent_snapshot_pair',
      sql`(${table.intentId} IS NULL AND ${table.intentSnapshot} IS NULL) OR (${table.intentId} IS NOT NULL AND jsonb_typeof(${table.intentSnapshot}) = 'object' AND ${table.intentSnapshot}->>'intent_id' = ${table.intentId}::text)`
    ),
    check(
      'tasks_plan_move_pair',
      sql`(${table.planObjectId} IS NULL) = (${table.moveCandidateId} IS NULL)`
    ),
    check(
      'tasks_origin_exclusive',
      sql`${table.intentId} IS NULL OR ${table.planObjectId} IS NULL`
    ),
    check(
      'tasks_schedule_slot_pair',
      sql`(${table.scheduleId} IS NULL) = (${table.scheduledFor} IS NULL)`
    ),
    check(
      'tasks_schedule_origin',
      sql`${table.scheduleId} IS NULL OR (${table.executionMode} = 'agent' AND ${table.activation} = 'automatic' AND ${table.idempotencyKey} IS NULL AND ${table.intentId} IS NULL AND ${table.intentSnapshot} IS NULL AND ${table.planObjectId} IS NULL AND ${table.moveCandidateId} IS NULL AND ${table.parentTaskId} IS NULL AND ${table.retryOfTaskId} IS NULL AND ${table.supersedesTaskId} IS NULL)`
    ),
    check(
      'tasks_parent_not_self',
      sql`${table.parentTaskId} IS NULL OR ${table.parentTaskId} <> ${table.id}`
    ),
    check(
      'tasks_payload_object',
      sql`jsonb_typeof(${table.payload}) = 'object'`
    ),
    check(
      'tasks_agent_superseded_shape',
      sql`NOT (${table.executionMode} = 'agent' AND ${table.status} = 'superseded') OR (${table.activation} = 'automatic' AND ${table.outcomeCode} = 'plan_move_excluded' AND ${table.startedAt} IS NULL AND ${table.intentId} IS NULL AND ${table.intentSnapshot} IS NULL AND ${table.planObjectId} IS NOT NULL AND ${table.moveCandidateId} IS NOT NULL AND ${table.retryOfTaskId} IS NULL AND ${table.supersedesTaskId} IS NULL AND ${table.scheduleId} IS NULL AND ${table.sessionId} IS NULL AND ${table.completion} IS NULL AND ${table.nextDueAt} IS NULL AND ${table.nextPayload} IS NULL AND ${table.nextRationale} IS NULL AND ${table.leasedUntil} IS NULL AND ${table.attempts} = 0)`
    ),
  ]
)

export const sessionEvents = pgTable(
  'session_events',
  {
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id'),
    event: jsonb('event').notNull(),
    eventKind: text('event_kind').notNull(),
    ingestedAt: timestampWithTimezone('ingested_at').defaultNow().notNull(),
    ingestionSequence: bigserial('ingestion_sequence', {
      mode: 'number',
    }).notNull(),
    metaId: text('meta_id').primaryKey(),
    occurredAt: timestampWithTimezone('occurred_at'),
    parentCallId: text('parent_call_id'),
    parentSessionId: text('parent_session_id'),
    rootSessionId: text('root_session_id').notNull(),
    sessionId: text('session_id').notNull(),
    taskId: uuid('task_id'),
  },
  (table) => [
    foreignKey({
      columns: [table.brandId, table.conversationId],
      foreignColumns: [cmoConversations.brandId, cmoConversations.id],
      name: 'session_events_conversation_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.taskId],
      foreignColumns: [tasks.brandId, tasks.id],
      name: 'session_events_task_same_brand_fk',
    }),
    unique('session_events_ingestion_sequence_unique').on(
      table.ingestionSequence
    ),
    unique('session_events_brand_meta_unique').on(table.brandId, table.metaId),
    index('session_events_session_replay_idx').on(
      table.sessionId,
      table.ingestionSequence
    ),
    index('session_events_root_session_idx').on(
      table.rootSessionId,
      table.ingestionSequence
    ),
    check(
      'session_events_event_object',
      sql`jsonb_typeof(${table.event}) = 'object'`
    ),
    check(
      'session_events_lineage_consistency',
      sql`(${table.parentSessionId} IS NULL AND ${table.parentCallId} IS NULL AND ${table.rootSessionId} = ${table.sessionId}) OR (${table.parentSessionId} IS NOT NULL AND ${table.parentCallId} IS NOT NULL)`
    ),
    check(
      'session_events_owner_exclusive',
      sql`num_nonnulls(${table.taskId}, ${table.conversationId}) <= 1`
    ),
  ]
)

export const creditLedger = pgTable(
  'credit_ledger',
  {
    actionId: uuid('action_id'),
    amount: numeric('amount', { precision: 20, scale: 6 }).notNull(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id'),
    createdAt: timestampWithTimezone('created_at').defaultNow().notNull(),
    currency: text('currency'),
    entryType: ledgerEntryType('entry_type').notNull(),
    gatewayCostUsd: numeric('gateway_cost_usd', {
      precision: 20,
      scale: 8,
    }),
    generationId: text('generation_id'),
    id: uuid('id').defaultRandom().primaryKey(),
    idempotencyKey: text('idempotency_key'),
    inputTokens: integer('input_tokens'),
    metadata: jsonb('metadata').default({}).notNull(),
    modelId: text('model_id'),
    outputTokens: integer('output_tokens'),
    pricingVersion: text('pricing_version'),
    sessionEventId: text('session_event_id'),
    sessionId: text('session_id'),
    taskId: uuid('task_id'),
  },
  (table) => [
    foreignKey({
      columns: [table.brandId, table.actionId],
      foreignColumns: [actions.brandId, actions.id],
      name: 'credit_ledger_action_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.taskId],
      foreignColumns: [tasks.brandId, tasks.id],
      name: 'credit_ledger_task_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.conversationId],
      foreignColumns: [cmoConversations.brandId, cmoConversations.id],
      name: 'credit_ledger_conversation_same_brand_fk',
    }),
    foreignKey({
      columns: [table.brandId, table.sessionEventId],
      foreignColumns: [sessionEvents.brandId, sessionEvents.metaId],
      name: 'credit_ledger_session_event_same_brand_fk',
    }),
    uniqueIndex('credit_ledger_session_event_unique')
      .on(table.sessionEventId)
      .where(sql`${table.sessionEventId} IS NOT NULL`),
    uniqueIndex('credit_ledger_action_unique')
      .on(table.actionId)
      .where(sql`${table.actionId} IS NOT NULL`),
    uniqueIndex('credit_ledger_idempotency_key_unique')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index('credit_ledger_brand_created_idx').on(table.brandId, table.createdAt),
    check('credit_ledger_amount_nonzero', sql`${table.amount} <> 0`),
    check(
      'credit_ledger_token_counts_nonnegative',
      sql`coalesce(${table.inputTokens}, 0) >= 0 AND coalesce(${table.outputTokens}, 0) >= 0`
    ),
    check(
      'credit_ledger_metadata_object',
      sql`jsonb_typeof(${table.metadata}) = 'object'`
    ),
    check(
      'credit_ledger_entry_shape',
      sql`(${table.entryType} = 'grant' AND ${table.amount} > 0 AND ${table.idempotencyKey} IS NOT NULL AND ${table.sessionEventId} IS NULL AND ${table.actionId} IS NULL AND ${table.currency} IS NULL) OR (${table.entryType} = 'model_charge' AND ${table.amount} < 0 AND ${table.sessionEventId} IS NOT NULL AND ${table.sessionId} IS NOT NULL AND ${table.modelId} IS NOT NULL AND ${table.inputTokens} IS NOT NULL AND ${table.outputTokens} IS NOT NULL AND ${table.actionId} IS NULL AND ${table.currency} IS NULL) OR (${table.entryType} = 'action_charge' AND ${table.amount} < 0 AND ${table.actionId} IS NOT NULL AND ${table.pricingVersion} IS NOT NULL AND ${table.currency} ~ '^[A-Z]{3}$' AND ${table.sessionEventId} IS NULL)`
    ),
    check(
      'credit_ledger_owner_exclusive',
      sql`num_nonnulls(${table.taskId}, ${table.conversationId}) <= 1`
    ),
  ]
)
