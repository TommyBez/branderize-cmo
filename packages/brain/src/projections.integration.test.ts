import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  createDatabase,
  createDatabasePool,
  type Database,
} from '@repo/db/client'
import { executeStatementsSequentially } from '@repo/db/test-support'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { TrustedMemberAccess } from './context'
import type { BrainError } from './errors'
import {
  getBrandImportStatus,
  getBrandIntent,
  getBrandObject,
  getBrandProjection,
  listBrandIntents,
  listBrandObjects,
  listTaskQuestionBundles,
} from './projections'

const MIGRATION_BREAKPOINT = '--> statement-breakpoint'
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001'
const ARTIFACT_HASH = 'a'.repeat(64)
const schemaName = `brain_projections_${randomUUID().replaceAll('-', '_')}`

const fixture = {
  actionId: randomUUID(),
  aliceActorId: randomUUID(),
  aliceUserId: `alice:${randomUUID()}`,
  artifactObjectId: randomUUID(),
  bobActorId: randomUUID(),
  bobUserId: `bob:${randomUUID()}`,
  brandAId: randomUUID(),
  brandBId: randomUUID(),
  brandContextObjectId: randomUUID(),
  intentAId: randomUUID(),
  intentBId: randomUUID(),
  openQuestionTaskId: randomUUID(),
  organizationAId: `organization-a:${randomUUID()}`,
  organizationBId: `organization-b:${randomUUID()}`,
  otherActorId: randomUUID(),
  otherUserId: `other:${randomUUID()}`,
  resolvedQuestionActionId: randomUUID(),
  resolvedQuestionTaskId: randomUUID(),
}

let adminPool: ReturnType<typeof createDatabasePool> | undefined
let database: Database | undefined
let databasePool: ReturnType<typeof createDatabasePool> | undefined

const requireDatabase = (): Database => {
  if (database === undefined) {
    throw new Error('The projections integration database is unavailable')
  }
  return database
}

const accessFor = ({
  actorId,
  brandId,
  organizationId,
  role,
  userId,
}: {
  readonly actorId: string
  readonly brandId: string
  readonly organizationId: string
  readonly role: TrustedMemberAccess['role']
  readonly userId: string
}): TrustedMemberAccess => ({
  brandId,
  humanActorId: actorId,
  humanActorKey: `human:${userId}`,
  organizationId,
  role,
  userId,
})

const bobViewerAccess = (): TrustedMemberAccess =>
  accessFor({
    actorId: fixture.bobActorId,
    brandId: fixture.brandAId,
    organizationId: fixture.organizationAId,
    role: 'viewer',
    userId: fixture.bobUserId,
  })

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for brain integration tests')
  }

  adminPool = createDatabasePool({ connectionString: databaseUrl, max: 1 })
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`)

  const scopedUrl = new URL(databaseUrl)
  scopedUrl.searchParams.set('options', `-c search_path=${schemaName},public`)
  const scopedDatabasePool = createDatabasePool({
    connectionString: scopedUrl.toString(),
    max: 2,
  })
  databasePool = scopedDatabasePool
  database = createDatabase(scopedDatabasePool)

  const migration = await readFile(
    new URL('../../db/drizzle/0000_phase0_foundation.sql', import.meta.url),
    'utf8'
  )
  const statements = migration
    .split(MIGRATION_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
  await executeStatementsSequentially({
    execute: (statement) => scopedDatabasePool.query(statement),
    statements,
  })

  await scopedDatabasePool.query(
    `INSERT INTO "user" (id, name, email)
     VALUES
       ($1, 'Alice', $2),
       ($3, 'Bob', $4),
       ($5, 'Other user', $6)`,
    [
      fixture.aliceUserId,
      `${randomUUID()}@example.test`,
      fixture.bobUserId,
      `${randomUUID()}@example.test`,
      fixture.otherUserId,
      `${randomUUID()}@example.test`,
    ]
  )
  await scopedDatabasePool.query(
    `INSERT INTO organization (id, name, slug)
     VALUES
       ($1, 'Organization A', $2),
       ($3, 'Organization B', $4)`,
    [
      fixture.organizationAId,
      `organization-a-${randomUUID()}`,
      fixture.organizationBId,
      `organization-b-${randomUUID()}`,
    ]
  )
  await databasePool.query(
    `INSERT INTO member (id, organization_id, user_id, role)
     VALUES
       ($1, $2, $3, 'owner'),
       ($4, $2, $5, 'viewer'),
       ($6, $7, $8, 'owner')`,
    [
      `member:${randomUUID()}`,
      fixture.organizationAId,
      fixture.aliceUserId,
      `member:${randomUUID()}`,
      fixture.bobUserId,
      `member:${randomUUID()}`,
      fixture.organizationBId,
      fixture.otherUserId,
    ]
  )
  await databasePool.query(
    `INSERT INTO brands (
       id, organization_id, name, slug, website_url, onboarding_status
     ) VALUES
       ($1, $2, 'Brand A', 'brand-a', 'https://a.example.test', 'ready'),
       ($3, $4, 'Brand B', 'brand-b', 'https://b.example.test', 'incomplete')`,
    [
      fixture.brandAId,
      fixture.organizationAId,
      fixture.brandBId,
      fixture.organizationBId,
    ]
  )
  await databasePool.query(
    `INSERT INTO actors (id, type, actor_key, user_id)
     VALUES
       ($1, 'human', $2, $3),
       ($4, 'human', $5, $6),
       ($7, 'human', $8, $9)`,
    [
      fixture.aliceActorId,
      `human:${fixture.aliceUserId}`,
      fixture.aliceUserId,
      fixture.bobActorId,
      `human:${fixture.bobUserId}`,
      fixture.bobUserId,
      fixture.otherActorId,
      `human:${fixture.otherUserId}`,
      fixture.otherUserId,
    ]
  )
  await databasePool.query(
    `INSERT INTO intents (
       id, brand_id, author_actor_id, statement, status, revision
     ) VALUES
       ($1, $2, $3, 'Launch Brand A', 'active', 1),
       ($4, $5, $6, 'Launch Brand B', 'active', 1)`,
    [
      fixture.intentAId,
      fixture.brandAId,
      fixture.aliceActorId,
      fixture.intentBId,
      fixture.brandBId,
      fixture.otherActorId,
    ]
  )
  await databasePool.query(
    `INSERT INTO actions (
       id, brand_id, actor_id, type, rationale, effect_class, payload,
       policy_snapshot, intent_id, session_id
     ) VALUES (
       $1, $2, $3, 'context_bootstrapped', 'Commit verified context',
       'graph-internal', '{}'::jsonb, '{}'::jsonb, $4, 'private-alice-session'
     )`,
    [fixture.actionId, fixture.brandAId, SYSTEM_ACTOR_ID, fixture.intentAId]
  )
  await databasePool.query(
    `INSERT INTO objects (
       id, brand_id, type, singleton_key, content, content_text, produced_by
     ) VALUES (
       $1, $2, 'brand_context', 'brand-context',
       '{"summary":"Verified context"}'::jsonb, 'Verified context', $3
     )`,
    [fixture.brandContextObjectId, fixture.brandAId, fixture.actionId]
  )
  await databasePool.query(
    `INSERT INTO objects (
       id, brand_id, type, content, content_text, produced_by, blob_key,
       blob_sha256, blob_content_type, blob_byte_size
     ) VALUES (
       $1, $2, 'artifact', '{"kind":"logo"}'::jsonb, 'Logo', $3, $4,
       $5, 'image/png', 128
     )`,
    [
      fixture.artifactObjectId,
      fixture.brandAId,
      fixture.actionId,
      `brands/${fixture.brandAId}/${ARTIFACT_HASH}/logo.png`,
      ARTIFACT_HASH,
    ]
  )

  const openCompletion = {
    intentAcceptance: null,
    openQuestions: ['Which market should we prioritize?'],
    outputObjectIds: [],
    result: { outcome: 'needs_input', reason: 'missing_human_context' },
    status: 'partial',
    summary: 'Market priority is missing.',
  }
  const resolvedCompletion = {
    intentAcceptance: null,
    openQuestions: ['Which proof point is approved?'],
    outputObjectIds: [],
    result: { outcome: 'needs_input', reason: 'insufficient_evidence' },
    status: 'blocked',
    summary: 'Approved evidence is missing.',
  }
  await databasePool.query(
    `INSERT INTO tasks (
       id, brand_id, kind, worker_key, subject_key, execution_mode, activation,
       status, payload, payload_hash, intent_id, intent_snapshot, completion,
       finished_at
     ) VALUES
       ($1, $2, 'product-marketer.brand-context.v1', 'product-marketer', $3,
        'agent', 'automatic', 'succeeded', '{"purpose":"enrich_brand_context"}'::jsonb,
        'open-hash', $4, $5::jsonb, $6::jsonb, now()),
       ($7, $2, 'product-marketer.brand-context.v1', 'product-marketer', $8,
        'agent', 'automatic', 'succeeded', '{"purpose":"enrich_brand_context"}'::jsonb,
        'resolved-hash', $4, $5::jsonb, $9::jsonb, now())`,
    [
      fixture.openQuestionTaskId,
      fixture.brandAId,
      `question-open:${randomUUID()}`,
      fixture.intentAId,
      JSON.stringify({ intent_id: fixture.intentAId, intent_revision: 1 }),
      JSON.stringify(openCompletion),
      fixture.resolvedQuestionTaskId,
      `question-resolved:${randomUUID()}`,
      JSON.stringify(resolvedCompletion),
    ]
  )
  await databasePool.query(
    `INSERT INTO actions (
       id, brand_id, actor_id, type, rationale, effect_class, payload,
       policy_snapshot, intent_id, task_id
     ) VALUES (
       $1, $2, $3, 'task_questions_resolved', 'Resolve the whole question bundle',
       'graph-internal', '{}'::jsonb, '{}'::jsonb, $4, $5
     )`,
    [
      fixture.resolvedQuestionActionId,
      fixture.brandAId,
      fixture.aliceActorId,
      fixture.intentAId,
      fixture.resolvedQuestionTaskId,
    ]
  )
})

afterAll(async () => {
  await databasePool?.end()
  if (adminPool !== undefined) {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await adminPool.end()
  }
})

describe('canonical projections on PostgreSQL', () => {
  it('lets a current viewer read organization-visible brand and Intent facts', async () => {
    await expect(
      getBrandProjection({
        access: bobViewerAccess(),
        database: requireDatabase(),
      })
    ).resolves.toMatchObject({
      id: fixture.brandAId,
      memberRole: 'viewer',
      onboardingStatus: 'ready',
    })

    const intents = await listBrandIntents({
      access: bobViewerAccess(),
      database: requireDatabase(),
      input: { status: 'active' },
    })
    expect(intents.items).toHaveLength(1)
    expect(intents.items[0]).toMatchObject({
      author: {
        actorKey: `human:${fixture.aliceUserId}`,
        id: fixture.aliceActorId,
      },
      id: fixture.intentAId,
      statement: 'Launch Brand A',
    })
    await expect(
      getBrandIntent({
        access: bobViewerAccess(),
        database: requireDatabase(),
        input: { intentId: fixture.intentBId },
      })
    ).resolves.toBeNull()
  })

  it('returns Object content and safe producing-Action provenance without session locators', async () => {
    const object = await getBrandObject({
      access: bobViewerAccess(),
      database: requireDatabase(),
      input: { objectId: fixture.brandContextObjectId },
    })
    expect(object).toMatchObject({
      content: { summary: 'Verified context' },
      id: fixture.brandContextObjectId,
      producedBy: {
        actor: { actorKey: 'system:context-dev', id: SYSTEM_ACTOR_ID },
        id: fixture.actionId,
        intentId: fixture.intentAId,
        type: 'context_bootstrapped',
      },
    })
    expect(object?.producedBy).not.toHaveProperty('sessionId')
    expect(object?.producedBy).not.toHaveProperty('callId')

    const artifacts = await listBrandObjects({
      access: bobViewerAccess(),
      database: requireDatabase(),
      input: { type: 'artifact' },
    })
    expect(artifacts.items).toHaveLength(1)
    expect(artifacts.items[0]?.binary).toEqual({
      byteSize: 128,
      contentType: 'image/png',
      kind: 'artifact',
      sha256: ARTIFACT_HASH,
    })
    expect(artifacts.items[0]?.binary).not.toHaveProperty('blobKey')
  })

  it('projects open and resolved immutable question bundles to any current Member', async () => {
    const open = await listTaskQuestionBundles({
      access: bobViewerAccess(),
      database: requireDatabase(),
      input: { state: 'open' },
    })
    expect(open.items).toEqual([
      expect.objectContaining({
        questions: ['Which market should we prioritize?'],
        resolution: { kind: 'open' },
        taskId: fixture.openQuestionTaskId,
      }),
    ])

    const resolved = await listTaskQuestionBundles({
      access: bobViewerAccess(),
      database: requireDatabase(),
      input: { state: 'resolved' },
    })
    expect(resolved.items).toEqual([
      expect.objectContaining({
        questions: ['Which proof point is approved?'],
        resolution: expect.objectContaining({
          actionId: fixture.resolvedQuestionActionId,
          kind: 'resolved',
        }),
        taskId: fixture.resolvedQuestionTaskId,
      }),
    ])
  })

  it('derives retry readiness only from the persisted import state and current head', async () => {
    await expect(
      getBrandImportStatus({
        access: bobViewerAccess(),
        database: requireDatabase(),
      })
    ).resolves.toEqual({
      currentBrandContextObjectId: fixture.brandContextObjectId,
      kind: 'ready',
      retryAvailable: false,
    })
  })

  it('fails closed when a Member from another organization names Brand A', async () => {
    const otherTenantAccess = accessFor({
      actorId: fixture.otherActorId,
      brandId: fixture.brandAId,
      organizationId: fixture.organizationBId,
      role: 'owner',
      userId: fixture.otherUserId,
    })
    await expect(
      listBrandObjects({
        access: otherTenantAccess,
        database: requireDatabase(),
        input: {},
      })
    ).rejects.toMatchObject({
      code: 'access_denied',
    } satisfies Partial<BrainError>)
  })
})
