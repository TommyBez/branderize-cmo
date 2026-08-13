# ADR-005: Drizzle + Neon for data access, Better Auth for authentication

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human)
- **Supersedes:** nothing — narrows ADR-002, which chose Postgres as the substrate but left the access tooling open

## Context

ADR-002 chose Postgres as the canonical store for the work graph but deliberately did not pick the ORM, the migration tool, or the hosting. The initial ARCHITECTURE.md draft referenced Prisma, following the [trycompai/crm](https://github.com/trycompai/crm) precedent (Prisma + Neon).

Four properties of our schema argue about the ORM and driver choice:

- **The work graph is SQL-native by design.** Current-state projections are indexed queries or ordinary SQL views, the task queue relies on `FOR UPDATE SKIP LOCKED`, append-only tables want database-level guarantees, and provenance invariants are foreign-key constraints. An ORM that stays close to SQL fits; one that abstracts SQL away forces raw-query escape hatches exactly where our invariants live.
- **The write path is transaction-heavy.** `approveTask`, provenance writes, queue claims, and other invariants must be able to acquire `FOR UPDATE` or transaction-scoped advisory locks, read the protected state, make a trusted TypeScript decision, and write the result before the same transaction commits. A predeclared HTTP transaction batch is not an interactive transaction.
- **The deployment target is [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute).** Concurrent invocations on one function instance should reuse a bounded module-scoped pool, while suspended instances must release idle connections through Vercel's database-pool lifecycle hook. Cross-instance coordination still belongs to Postgres, never to process memory.
- **Authentication is Better Auth** (already recorded in ADR-001: Google sign-in and organization-wide membership). Better Auth ships a first-party Drizzle adapter, so one ORM covers both the auth tables and the domain tables. `Member(organization_id, user_id)` is the only v1 human membership relation; there is no Better Auth Team or `brand_memberships` table.

## Decision

- **[Drizzle ORM](https://orm.drizzle.team/)** as the schema, query, and migration layer (`drizzle-kit` for migrations), in `packages/db`
- **[Neon](https://neon.tech/)** serverless Postgres as the database
- **`drizzle-orm/node-postgres` over `pg.Pool`** as the single canonical v1 runtime adapter. Every live function instance creates one bounded, module-scoped pool from the pooled Neon `DATABASE_URL` and registers it with Vercel's [`attachDatabasePool(pool)`](https://vercel.com/kb/guide/connection-pooling-with-functions) lifecycle hook. No pool or connection is shared in memory across instances or deployments.
- **A direct, non-pooled `DIRECT_DATABASE_URL`** for `drizzle-kit` and migrations. Runtime application code must not use it.
- **[Better Auth](https://better-auth.com)** for authentication (confirming ADR-001), using its Drizzle adapter so auth schema and work-graph schema live in the same migration chain

## Consequences

- **Raw SQL is a first-class citizen**: ordinary views, partial indexes, aggregate queries, queue leasing, and append-only enforcement are written as SQL without fighting the ORM — the invariants of ADR-002 live where they belong. If measured load later requires a projection table, the write path updates it transactionally and proves it rebuildable; v1 does not use PostgreSQL materialized views.
- **Fluid-aware pooling**: concurrent invocations within one Fluid Compute instance reuse its `pg.Pool`; `attachDatabasePool` closes idle connections before suspension. The Neon pooled endpoint provides the cross-instance PgBouncer layer, so no pooler sidecar is required.
- **Transaction semantics are explicit**: all protected reads, locks, decisions, and writes use the `tx` supplied by `db.transaction(...)`. Only transaction-scoped advisory locks such as `pg_advisory_xact_lock` are allowed; session-level locks or session state are incompatible with Neon's transaction-pooling endpoint. External network calls never run inside these database transactions.
- **Pool size is operational configuration, not an architectural constant**: start bounded, use a short idle timeout, never force `max: 1`, and calibrate against Fluid concurrency plus Neon pooler metrics. Each deployment and each scaled instance owns a separate pool; durable coordination therefore remains in Postgres.
- **One migration chain** covers Better Auth tables and the grammar-layer tables; auth schema changes are reviewed like any other schema change.
- **Human Actor materialization is transaction-safe and global.** After the boundary validates the exact Better Auth Member, `ensureHumanActor(tx, userId)` inserts `human:<userId>` with `ON CONFLICT (user_id) DO NOTHING RETURNING id`; if another transaction won, it selects that same `user_id` inside the transaction. Callers never submit an Actor id or key. The unique user foreign key and actor-key constraint make concurrent first writes, including writes in two organizations, converge on one Actor row.
- **Hard User deletion is disabled in v1.** The human Actor's `user_id` foreign key uses `ON DELETE RESTRICT`; the Better Auth delete-user capability is not enabled or exposed. Organization offboarding deletes Member rows and revokes sessions instead. This preserves non-null Intent/Action attribution and avoids pretending that `SET NULL` is a complete anonymization protocol.
- **Brand authorization remains an explicit join, not ambient ORM state**: a boundary loads `brands.organization_id` from its required `brand_id` and validates the exact Better Auth `Member(organization_id, user_id)`. All domain reads and writes still carry and filter by `brand_id`; an organization membership predicate alone is never accepted as data scoping.
- **Cost accepted**: we lose the CRM's copy-pasteable Prisma precedent and Prisma's relation-query ergonomics. Mitigation: all writes go through `packages/brain` anyway, so ORM ergonomics matter far less than SQL fidelity — the write path is hand-written by construction.
- **Local development**: Neon branching doubles as the per-developer database story; a `docker compose` Postgres remains acceptable for offline work since Drizzle speaks plain Postgres.
- **Concurrency is integration-tested against real Postgres**: at minimum concurrent first writes for the same User converge on one human Actor; membership offboarding removes access without removing its Actor; a direct User delete is rejected; approval-vs-approval, approval-vs-organization-membership-downgrade/removal in both lock orders, wrong-organization rejection, edit-vs-approval, cancel-vs-claim, queue claim, and transaction rollback tests prove that a losing transaction leaves neither partial state nor an orphan Action.
- **Authorization contracts exercise both dimensions separately**: one Member can cross the access boundary for two brands in its organization, cannot cross it for a brand in another organization, a viewer can read ordinary brand projections but cannot perform product mutations or approve, and every successful query still returns rows only for the requested `brand_id`. Conversation metadata/transcript/snapshot/stream require the additional exact `owner_user_id` predicate even for another same-organization owner/admin, and ADR-016's exact-owner, exact-`turnId` stop exception remains outside this generic contract; both are tested at the CMO proxy/application boundary.

## Alternatives considered

- **Prisma + Neon (the CRM stack)** — rejected: the current CRM proves that a `pg`-compatible client and interactive transactions work in production, but its relation API still sits between us and the SQL features this work graph uses directly. We copy the transaction-capable `pg` substrate, not the ORM.
- **`drizzle-orm/neon-http` as the canonical runtime adapter** — rejected for v1: Neon HTTP can atomically execute a predeclared non-interactive transaction, but it cannot keep the transaction open while application code reads a result and chooses subsequent statements. Encoding the whole approval and Policy path in one CTE or stored function is technically possible but would split the TypeScript registry and Policy boundary across application code and SQL. Isolated HTTP reads may be reconsidered only after a measured need justifies a second database stack.
- **`drizzle-orm/neon-serverless` with a WebSocket `Pool`** — valid transaction semantics, but rejected for v1 because the Node.js Fluid Compute runtime already supports `pg.Pool` directly. WebSocket setup and lifecycle add another moving part without improving the required guarantees. The current CRM production precedent also uses a `pg`-compatible transaction-capable client.
- **Drizzle + a containerized Postgres (e.g. Railway/Supabase)** — rejected for now: Neon's branching and scale-to-zero fit the early phase; Drizzle keeps the door open to any Postgres later, since the coupling is to Postgres, not to Neon.
