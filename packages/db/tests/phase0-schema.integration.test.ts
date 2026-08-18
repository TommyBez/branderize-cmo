import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { executeStatementsSequentially } from '../src/test-support'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001'
const DATABASE_ERROR = {
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  immutableRow: '55000',
  uniqueViolation: '23505',
} as const

const schemaName = `phase0_${randomUUID().replaceAll('-', '_')}`
const fixture = {
  brandAId: randomUUID(),
  brandBId: randomUUID(),
  humanActorId: randomUUID(),
  organizationId: `organization:${randomUUID()}`,
  userId: `user:${randomUUID()}`,
}

let databaseClient: PoolClient | undefined
let databasePool: Pool | undefined

const query = <Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = []
): Promise<QueryResult<Row>> => {
  if (!databaseClient) {
    throw new Error('The integration database has not been initialized')
  }

  return databaseClient.query<Row>(text, [...values])
}

const expectDatabaseError = async (
  operation: Promise<unknown>,
  code: string
): Promise<void> => {
  await expect(operation).rejects.toMatchObject({ code })
}

const materializeHumanActor = async (
  userId: string,
  proposedActorId: string
): Promise<string> => {
  if (!databasePool) {
    throw new Error('The integration database pool has not been initialized')
  }

  const client = await databasePool.connect()
  try {
    await client.query(`SET search_path TO "${schemaName}", public`)
    await client.query('BEGIN')
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO actors (id, type, actor_key, user_id)
       VALUES ($1, 'human', $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [proposedActorId, `human:${userId}`, userId]
    )
    const insertedId = inserted.rows[0]?.id
    const actorId =
      insertedId ??
      (
        await client.query<{ id: string }>(
          'SELECT id FROM actors WHERE user_id = $1',
          [userId]
        )
      ).rows[0]?.id

    if (!actorId) {
      throw new Error('Human Actor materialization did not return an Actor')
    }

    await client.query('COMMIT')
    return actorId
  } catch (error: unknown) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

interface InsertActionInput {
  brandId: string
  conversationId?: string
  id?: string
  intentId?: string
  operationKey?: string
  requestHash?: string
  sessionId?: string
  taskId?: string
  turnId?: string
  type?: string
}

const insertAction = async ({
  brandId,
  conversationId,
  id = randomUUID(),
  intentId,
  operationKey,
  requestHash,
  sessionId,
  taskId,
  turnId,
  type = 'integration_fact_recorded',
}: InsertActionInput): Promise<string> => {
  await query(
    `INSERT INTO actions (
      id,
      brand_id,
      actor_id,
      type,
      rationale,
      effect_class,
      payload,
      policy_snapshot,
      operation_key,
      request_hash,
      intent_id,
      task_id,
      conversation_id,
      session_id,
      turn_id
    ) VALUES (
      $1, $2, $3, $4, $5, $6, '{}'::jsonb, '{}'::jsonb,
      $7, $8, $9, $10, $11, $12, $13
    )`,
    [
      id,
      brandId,
      SYSTEM_ACTOR_ID,
      type,
      'Integration invariant fixture',
      'graph-internal',
      operationKey ?? null,
      requestHash ?? null,
      intentId ?? null,
      taskId ?? null,
      conversationId ?? null,
      sessionId ?? null,
      turnId ?? null,
    ]
  )

  return id
}

interface InsertQueuedAgentTaskInput {
  brandId: string
  id?: string
  intentId?: string
  kind?: string
  scheduledFor?: Date
  scheduleId?: string
  sessionId?: string
  subjectKey?: string
}

const insertQueuedAgentTask = async ({
  brandId,
  id = randomUUID(),
  intentId,
  kind = 'integration-agent-task',
  scheduleId,
  scheduledFor,
  sessionId,
  subjectKey = `subject:${randomUUID()}`,
}: InsertQueuedAgentTaskInput): Promise<string> => {
  const intentSnapshot = intentId
    ? JSON.stringify({ intent_id: intentId, intent_revision: 1 })
    : null

  await query(
    `INSERT INTO tasks (
      id,
      brand_id,
      kind,
      worker_key,
      subject_key,
      execution_mode,
      activation,
      status,
      payload,
      payload_hash,
      intent_id,
      intent_snapshot,
      schedule_id,
      scheduled_for,
      session_id
    ) VALUES (
      $1, $2, $3, 'product-marketer', $4, 'agent', 'automatic', 'queued',
      '{}'::jsonb, 'payload-hash', $5, $6::jsonb, $7, $8, $9
    )`,
    [
      id,
      brandId,
      kind,
      subjectKey,
      intentId ?? null,
      intentSnapshot,
      scheduleId ?? null,
      scheduledFor ?? null,
      sessionId ?? null,
    ]
  )

  return id
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for database integration tests')
  }

  databasePool = new Pool({
    allowExitOnIdle: true,
    connectionString: databaseUrl,
    max: 3,
  })
  databaseClient = await databasePool.connect()

  await query(`CREATE SCHEMA "${schemaName}"`)
  await query(`SET search_path TO "${schemaName}", public`)

  const migration = await readFile(
    new URL('../drizzle/0000_phase0_foundation.sql', import.meta.url),
    'utf8'
  )
  const statements = migration
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)

  await executeStatementsSequentially({ execute: query, statements })

  await query(
    `INSERT INTO "user" (id, name, email)
     VALUES ($1, 'Phase 0 Owner', $2)`,
    [fixture.userId, `${randomUUID()}@example.test`]
  )
  await query(
    `INSERT INTO organization (id, name, slug)
     VALUES ($1, 'Phase 0 Organization', $2)`,
    [fixture.organizationId, `organization-${randomUUID()}`]
  )
  await query(
    `INSERT INTO member (id, organization_id, user_id, role)
     VALUES ($1, $2, $3, 'owner')`,
    [`member:${randomUUID()}`, fixture.organizationId, fixture.userId]
  )
  await query(
    `INSERT INTO brands (id, organization_id, name, slug, website_url)
     VALUES
       ($1, $3, 'Brand A', 'brand-a', 'https://a.example.test'),
       ($2, $3, 'Brand B', 'brand-b', 'https://b.example.test')`,
    [fixture.brandAId, fixture.brandBId, fixture.organizationId]
  )
  await query(
    `INSERT INTO actors (id, type, actor_key, user_id)
     VALUES ($1, 'human', $2, $3)`,
    [fixture.humanActorId, `human:${fixture.userId}`, fixture.userId]
  )
}, 30_000)

afterAll(async () => {
  const client = databaseClient
  const pool = databasePool

  try {
    if (client) {
      await client.query('RESET search_path')
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    }
  } finally {
    client?.release()
    if (pool) {
      await pool.end()
    }
  }
}, 30_000)

describe('Phase 0 PostgreSQL foundation', () => {
  it('migrates the complete auth and work-graph schema', async () => {
    const tables = await query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = current_schema()
       ORDER BY tablename`
    )

    expect(tables.rows.map(({ tablename }) => tablename)).toEqual([
      'account',
      'actions',
      'actors',
      'brands',
      'cmo_conversations',
      'credit_ledger',
      'intents',
      'invitation',
      'member',
      'objects',
      'organization',
      'schedules',
      'session',
      'session_events',
      'tasks',
      'user',
      'verification',
    ])

    const constraints = await query<{ conname: string }>(
      `SELECT conname
       FROM pg_constraint
       WHERE connamespace = current_schema()::regnamespace`
    )
    const constraintNames = new Set(
      constraints.rows.map(({ conname }) => conname)
    )

    const tenantSafeConstraints = [
      'actions_task_same_brand_fk',
      'credit_ledger_session_event_same_brand_fk',
      'objects_produced_by_same_brand_fk',
      'session_events_task_same_brand_fk',
      'tasks_intent_same_brand_fk',
      'tasks_schedule_same_brand_fk',
    ]
    for (const constraintName of tenantSafeConstraints) {
      expect(constraintNames).toContain(constraintName)
    }

    const seededActors = await query<{ actor_key: string; type: string }>(
      `SELECT actor_key, type
       FROM actors
       WHERE actor_key LIKE 'agent:%' OR actor_key LIKE 'system:%'
       ORDER BY actor_key`
    )
    expect(seededActors.rows).toEqual([
      { actor_key: 'agent:cmo', type: 'agent' },
      { actor_key: 'agent:content', type: 'agent' },
      { actor_key: 'agent:distribution', type: 'agent' },
      { actor_key: 'agent:growth', type: 'agent' },
      { actor_key: 'agent:lifecycle', type: 'agent' },
      { actor_key: 'agent:product-marketer', type: 'agent' },
      { actor_key: 'agent:seo-discovery', type: 'agent' },
      { actor_key: 'system:context-dev', type: 'system' },
      { actor_key: 'system:schedule-dispatcher', type: 'system' },
    ])
  })

  it('keeps Better Auth membership separate from global Actor identity', async () => {
    const secondUserId = `user:${randomUUID()}`
    await query(
      `INSERT INTO "user" (id, name, email)
       VALUES ($1, 'Second User', $2)`,
      [secondUserId, `${randomUUID()}@example.test`]
    )

    await expectDatabaseError(
      query(
        `INSERT INTO actors (type, actor_key, user_id)
         VALUES ('human', 'human:wrong-user', $1)`,
        [secondUserId]
      ),
      DATABASE_ERROR.checkViolation
    )

    await query(
      `INSERT INTO actors (type, actor_key, user_id)
       VALUES ('human', $1, $2)`,
      [`human:${secondUserId}`, secondUserId]
    )
    await query(
      `INSERT INTO actors (type, actor_key) VALUES
       ('agent', $1),
       ('system', $2)`,
      [`agent:${randomUUID()}`, `system:${randomUUID()}`]
    )

    await expectDatabaseError(
      query(
        `INSERT INTO actors (type, actor_key, user_id)
         VALUES ('human', $1, $2)`,
        [`human:${secondUserId}`, secondUserId]
      ),
      DATABASE_ERROR.uniqueViolation
    )
    await expectDatabaseError(
      query(
        `INSERT INTO member (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'super-admin')`,
        [`member:${randomUUID()}`, fixture.organizationId, secondUserId]
      ),
      DATABASE_ERROR.checkViolation
    )
    await expectDatabaseError(
      query(`DELETE FROM "user" WHERE id = $1`, [secondUserId]),
      DATABASE_ERROR.foreignKeyViolation
    )

    const concurrentUserId = `user:${randomUUID()}`
    await query(
      `INSERT INTO "user" (id, name, email)
       VALUES ($1, 'Concurrent User', $2)`,
      [concurrentUserId, `${randomUUID()}@example.test`]
    )
    const [firstActorId, secondActorId] = await Promise.all([
      materializeHumanActor(concurrentUserId, randomUUID()),
      materializeHumanActor(concurrentUserId, randomUUID()),
    ])
    expect(firstActorId).toBe(secondActorId)
  })

  it('rejects cross-brand graph links at every composite boundary', async () => {
    const intentId = randomUUID()
    await query(
      `INSERT INTO intents (id, brand_id, author_actor_id, statement, status)
       VALUES ($1, $2, $3, 'Ship a measurable launch', 'active')`,
      [intentId, fixture.brandAId, fixture.humanActorId]
    )

    await expectDatabaseError(
      query(
        `INSERT INTO intents (
          brand_id, author_actor_id, parent_intent_id, statement, status
        ) VALUES ($1, $2, $3, 'Cross-brand child', 'active')`,
        [fixture.brandBId, fixture.humanActorId, intentId]
      ),
      DATABASE_ERROR.foreignKeyViolation
    )

    const producerActionId = await insertAction({
      brandId: fixture.brandAId,
      intentId,
    })
    await expectDatabaseError(
      query(
        `INSERT INTO objects (
          brand_id, type, content, content_text, produced_by
        ) VALUES ($1, 'report', '{}'::jsonb, 'Cross-brand object', $2)`,
        [fixture.brandBId, producerActionId]
      ),
      DATABASE_ERROR.foreignKeyViolation
    )

    const taskId = await insertQueuedAgentTask({
      brandId: fixture.brandAId,
      intentId,
    })
    await expectDatabaseError(
      insertAction({ brandId: fixture.brandBId, taskId }),
      DATABASE_ERROR.foreignKeyViolation
    )
  })

  it('uses Actions as immutable operation receipts and Objects as versioned heads', async () => {
    const operationKey = `integration:${randomUUID()}`
    const receiptActionId = await insertAction({
      brandId: fixture.brandAId,
      operationKey,
      requestHash: 'request-hash-a',
    })

    await expectDatabaseError(
      insertAction({
        brandId: fixture.brandAId,
        operationKey,
        requestHash: 'request-hash-b',
      }),
      DATABASE_ERROR.uniqueViolation
    )
    await insertAction({
      brandId: fixture.brandBId,
      operationKey,
      requestHash: 'request-hash-b',
    })
    await expectDatabaseError(
      insertAction({
        brandId: fixture.brandAId,
        operationKey: `missing-hash:${randomUUID()}`,
      }),
      DATABASE_ERROR.checkViolation
    )
    await expectDatabaseError(
      query(`UPDATE actions SET rationale = 'Rewritten' WHERE id = $1`, [
        receiptActionId,
      ]),
      DATABASE_ERROR.immutableRow
    )
    await expectDatabaseError(
      query('DELETE FROM actions WHERE id = $1', [receiptActionId]),
      DATABASE_ERROR.immutableRow
    )

    const oldObjectId = randomUUID()
    await query(
      `INSERT INTO objects (
        id, brand_id, type, singleton_key, content, content_text, produced_by
      ) VALUES ($1, $2, 'brand_context', 'brand-context', '{}'::jsonb, $3, $4)`,
      [oldObjectId, fixture.brandAId, 'Launch context', receiptActionId]
    )
    await expectDatabaseError(
      query(
        `INSERT INTO objects (
          brand_id, type, singleton_key, content, content_text, produced_by
        ) VALUES ($1, 'brand_context', 'brand-context', '{}'::jsonb, 'Duplicate', $2)`,
        [fixture.brandAId, receiptActionId]
      ),
      DATABASE_ERROR.uniqueViolation
    )
    await expectDatabaseError(
      query(`UPDATE objects SET content_text = 'Rewritten' WHERE id = $1`, [
        oldObjectId,
      ]),
      DATABASE_ERROR.immutableRow
    )

    const newObjectId = randomUUID()
    await query('BEGIN')
    try {
      await query(
        `UPDATE objects
         SET status = 'superseded', superseded_by = $1, superseded_at = now()
         WHERE id = $2`,
        [newObjectId, oldObjectId]
      )
      await query(
        `INSERT INTO objects (
          id, brand_id, type, singleton_key, content, content_text, produced_by
        ) VALUES ($1, $2, 'brand_context', 'brand-context', '{}'::jsonb, $3, $4)`,
        [newObjectId, fixture.brandAId, 'Replacement context', receiptActionId]
      )
      await query('COMMIT')
    } catch (error: unknown) {
      await query('ROLLBACK')
      throw error
    }

    await expectDatabaseError(
      query(
        `UPDATE objects
         SET superseded_at = now() + interval '1 second'
         WHERE id = $1`,
        [oldObjectId]
      ),
      DATABASE_ERROR.immutableRow
    )

    const artifactSha = 'a'.repeat(64)
    await query(
      `INSERT INTO objects (
        brand_id,
        type,
        content,
        content_text,
        blob_key,
        blob_sha256,
        blob_content_type,
        blob_byte_size,
        produced_by
      ) VALUES ($1, 'artifact', '{}'::jsonb, 'Launch image', $2, $3, 'image/png', 42, $4)`,
      [
        fixture.brandAId,
        `brands/${fixture.brandAId}/${artifactSha}`,
        artifactSha,
        receiptActionId,
      ]
    )
    await expectDatabaseError(
      query(
        `INSERT INTO objects (
          brand_id, type, content, content_text, produced_by
        ) VALUES ($1, 'artifact', '{}'::jsonb, 'Missing blob', $2)`,
        [fixture.brandAId, receiptActionId]
      ),
      DATABASE_ERROR.checkViolation
    )

    const searchResult = await query<{ matches: boolean }>(
      `SELECT search_vector @@ plainto_tsquery('simple', 'replacement') AS matches
       FROM objects
       WHERE id = $1`,
      [newObjectId]
    )
    expect(searchResult.rows[0]?.matches).toBe(true)
  })

  it('enforces one-shot task completion and deterministic schedule identity', async () => {
    const scheduleId = randomUUID()
    await query(
      `INSERT INTO schedules (
        id,
        brand_id,
        schedule_key,
        worker_key,
        kind,
        fixed_payload,
        payload_digest,
        cadence,
        local_time,
        time_zone,
        enabled,
        next_scheduled_for
      ) VALUES (
        $1, $2, 'daily-brief', 'product-marketer', 'daily-brief', '{}'::jsonb,
        'payload-digest', 'daily', '09:00', 'Europe/Rome', true, now() + interval '1 day'
      )`,
      [scheduleId, fixture.brandAId]
    )

    const scheduledFor = new Date(Date.now() + 60_000)
    const scheduledTaskId = await insertQueuedAgentTask({
      brandId: fixture.brandAId,
      kind: 'daily-brief',
      scheduledFor,
      scheduleId,
      subjectKey: `schedule:${scheduleId}:${scheduledFor.toISOString()}`,
    })

    await expectDatabaseError(
      insertQueuedAgentTask({
        brandId: fixture.brandAId,
        kind: 'daily-brief',
        scheduledFor,
        scheduleId,
      }),
      DATABASE_ERROR.uniqueViolation
    )
    await expectDatabaseError(
      insertQueuedAgentTask({
        brandId: fixture.brandAId,
        kind: 'daily-brief',
        scheduledFor: new Date(scheduledFor.getTime() + 86_400_000),
        scheduleId,
      }),
      DATABASE_ERROR.uniqueViolation
    )
    await expectDatabaseError(
      insertQueuedAgentTask({
        brandId: fixture.brandAId,
        sessionId: `session:${randomUUID()}`,
      }),
      DATABASE_ERROR.checkViolation
    )

    await query(
      `UPDATE tasks
       SET status = 'running', started_at = now(), session_id = $1
       WHERE id = $2`,
      [`session:${randomUUID()}`, scheduledTaskId]
    )
    await expectDatabaseError(
      query('UPDATE tasks SET session_id = $1 WHERE id = $2', [
        `session:${randomUUID()}`,
        scheduledTaskId,
      ]),
      DATABASE_ERROR.immutableRow
    )
    await query(
      `UPDATE tasks
       SET completion = '{"status":"partial","open_questions":["Which market?"]}'::jsonb
       WHERE id = $1`,
      [scheduledTaskId]
    )
    await expectDatabaseError(
      query(
        `UPDATE tasks
         SET completion = '{"status":"completed"}'::jsonb
         WHERE id = $1`,
        [scheduledTaskId]
      ),
      DATABASE_ERROR.immutableRow
    )
    await query(
      `UPDATE tasks
       SET status = 'succeeded', finished_at = now()
       WHERE id = $1`,
      [scheduledTaskId]
    )

    await expectDatabaseError(
      query(
        `INSERT INTO tasks (
          brand_id, kind, worker_key, subject_key, execution_mode, activation,
          status, payload, payload_hash, finished_at
        ) VALUES (
          $1, 'invalid-success', 'product-marketer', $2, 'agent', 'automatic',
          'succeeded', '{}'::jsonb, 'payload-hash', now()
        )`,
        [fixture.brandAId, `subject:${randomUUID()}`]
      ),
      DATABASE_ERROR.checkViolation
    )
  })

  it('preserves owner-private conversation bindings and append-only billing', async () => {
    const conversationId = randomUUID()
    const sessionId = `session:${randomUUID()}`
    await query(
      `INSERT INTO cmo_conversations (id, brand_id, owner_user_id)
       VALUES ($1, $2, $3)`,
      [conversationId, fixture.brandAId, fixture.userId]
    )
    await query(
      `UPDATE cmo_conversations
       SET session_id = $1, stream_index = 4
       WHERE id = $2`,
      [sessionId, conversationId]
    )
    await expectDatabaseError(
      query('UPDATE cmo_conversations SET session_id = $1 WHERE id = $2', [
        `session:${randomUUID()}`,
        conversationId,
      ]),
      DATABASE_ERROR.immutableRow
    )
    await expectDatabaseError(
      query('UPDATE cmo_conversations SET stream_index = 3 WHERE id = $1', [
        conversationId,
      ]),
      DATABASE_ERROR.immutableRow
    )

    const sessionEventId = `event:${randomUUID()}`
    await query(
      `INSERT INTO session_events (
        meta_id,
        brand_id,
        session_id,
        root_session_id,
        conversation_id,
        event_kind,
        event
      ) VALUES ($1, $2, $3, $3, $4, 'step.completed', '{}'::jsonb)`,
      [sessionEventId, fixture.brandAId, sessionId, conversationId]
    )
    await expectDatabaseError(
      query(
        `UPDATE session_events SET event_kind = 'message.created' WHERE meta_id = $1`,
        [sessionEventId]
      ),
      DATABASE_ERROR.immutableRow
    )
    await expectDatabaseError(
      query(
        `INSERT INTO session_events (
          meta_id, brand_id, session_id, root_session_id, event_kind, event
        ) VALUES ($1, $2, 'other-session', 'other-session', 'step.completed', '{}'::jsonb)`,
        [sessionEventId, fixture.brandBId]
      ),
      DATABASE_ERROR.uniqueViolation
    )

    const chargeId = randomUUID()
    await query(
      `INSERT INTO credit_ledger (
        id,
        brand_id,
        entry_type,
        amount,
        session_event_id,
        session_id,
        conversation_id,
        model_id,
        input_tokens,
        output_tokens,
        gateway_cost_usd
      ) VALUES ($1, $2, 'model_charge', -3, $3, $4, $5, 'model:test', 10, 20, 0.001)`,
      [chargeId, fixture.brandAId, sessionEventId, sessionId, conversationId]
    )
    await expectDatabaseError(
      query(
        `INSERT INTO credit_ledger (
          brand_id,
          entry_type,
          amount,
          session_event_id,
          session_id,
          model_id,
          input_tokens,
          output_tokens
        ) VALUES ($1, 'model_charge', -3, $2, $3, 'model:test', 10, 20)`,
        [fixture.brandAId, sessionEventId, sessionId]
      ),
      DATABASE_ERROR.uniqueViolation
    )
    await expectDatabaseError(
      query('UPDATE credit_ledger SET amount = -4 WHERE id = $1', [chargeId]),
      DATABASE_ERROR.immutableRow
    )
    await expectDatabaseError(
      query('DELETE FROM credit_ledger WHERE id = $1', [chargeId]),
      DATABASE_ERROR.immutableRow
    )

    const billableActionId = await insertAction({ brandId: fixture.brandAId })
    await query(
      `INSERT INTO credit_ledger (
        brand_id, entry_type, amount, action_id, currency, pricing_version
      ) VALUES ($1, 'action_charge', -10, $2, 'EUR', 'alpha-v1')`,
      [fixture.brandAId, billableActionId]
    )
    await expectDatabaseError(
      query(
        `INSERT INTO credit_ledger (
          brand_id, entry_type, amount, action_id, currency, pricing_version
        ) VALUES ($1, 'action_charge', -10, $2, 'credits', 'alpha-v1')`,
        [fixture.brandAId, await insertAction({ brandId: fixture.brandAId })]
      ),
      DATABASE_ERROR.checkViolation
    )
  })

  it('enforces indexed Action conversation and turn lineage', async () => {
    const conversationId = randomUUID()
    const sessionId = `session:${randomUUID()}`
    await query(
      `INSERT INTO cmo_conversations (
        id, brand_id, owner_user_id, session_id
      ) VALUES ($1, $2, $3, $4)`,
      [conversationId, fixture.brandAId, fixture.userId, sessionId]
    )

    await expect(
      insertAction({
        brandId: fixture.brandAId,
        conversationId,
        sessionId,
        turnId: `turn:${randomUUID()}`,
      })
    ).resolves.toEqual(expect.any(String))
    await expectDatabaseError(
      insertAction({ brandId: fixture.brandAId, conversationId, sessionId }),
      DATABASE_ERROR.checkViolation
    )
    await expectDatabaseError(
      insertAction({
        brandId: fixture.brandAId,
        conversationId,
        turnId: `turn:${randomUUID()}`,
      }),
      DATABASE_ERROR.checkViolation
    )
    await expectDatabaseError(
      insertAction({
        brandId: fixture.brandAId,
        conversationId,
        sessionId: `session:${randomUUID()}`,
        turnId: `turn:${randomUUID()}`,
      }),
      DATABASE_ERROR.foreignKeyViolation
    )

    const lineageIndexes = await query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [
        [
          'actions_brand_conversation_created_idx',
          'actions_brand_conversation_session_turn_idx',
        ],
      ]
    )
    expect(lineageIndexes.rows.map(({ indexname }) => indexname)).toEqual([
      'actions_brand_conversation_created_idx',
      'actions_brand_conversation_session_turn_idx',
    ])
  })

  it('cascades a deleted tenant through otherwise immutable rows', async () => {
    const disposableBrandId = randomUUID()
    await query(
      `INSERT INTO brands (id, organization_id, name, slug, website_url)
       VALUES ($1, $2, 'Disposable Brand', $3, 'https://delete.example.test')`,
      [disposableBrandId, fixture.organizationId, `disposable-${randomUUID()}`]
    )
    const actionId = await insertAction({ brandId: disposableBrandId })
    await query(
      `INSERT INTO credit_ledger (
        brand_id, entry_type, amount, idempotency_key
      ) VALUES ($1, 'grant', 100, $2)`,
      [disposableBrandId, `alpha-grant:${disposableBrandId}`]
    )

    await query('DELETE FROM brands WHERE id = $1', [disposableBrandId])

    const retainedRows = await query<{ row_count: string }>(
      `SELECT (
        (SELECT count(*) FROM actions WHERE id = $1) +
        (SELECT count(*) FROM credit_ledger WHERE brand_id = $2)
      )::text AS row_count`,
      [actionId, disposableBrandId]
    )
    expect(retainedRows.rows[0]?.row_count).toBe('0')
  })
})
