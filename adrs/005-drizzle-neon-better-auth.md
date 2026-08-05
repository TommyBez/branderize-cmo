# ADR-005: Drizzle + Neon for data access, Better Auth for authentication

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human)
- **Supersedes:** nothing — narrows ADR-002, which chose Postgres as the substrate but left the access tooling open

## Context

ADR-002 chose Postgres as the canonical store for the work graph but deliberately did not pick the ORM, the migration tool, or the hosting. The initial ARCHITECTURE.md draft referenced Prisma, following the [trycompai/crm](https://github.com/trycompai/crm) precedent (Prisma + Neon).

Three properties of our schema argue about the ORM choice:

- **The work graph is SQL-native by design.** Projections are materialized views, the task queue relies on `FOR UPDATE SKIP LOCKED`, append-only tables want database-level guarantees, and provenance invariants are foreign-key constraints. An ORM that stays close to SQL fits; one that abstracts SQL away forces raw-query escape hatches exactly where our invariants live.
- **The deployment target is Vercel.** Serverless functions want a serverless-native Postgres driver with connection pooling over HTTP/WebSocket, not a long-lived TCP pool per instance.
- **Authentication is Better Auth** (already recorded in ADR-001: Google sign-in, org membership). Better Auth ships a first-party Drizzle adapter, so one ORM covers both the auth tables and the domain tables.

## Decision

- **[Drizzle ORM](https://orm.drizzle.team/)** as the schema, query, and migration layer (`drizzle-kit` for migrations), in `packages/db`
- **[Neon](https://neon.tech/)** serverless Postgres as the database, via the `@neondatabase/serverless` driver
- **[Better Auth](https://better-auth.com)** for authentication (confirming ADR-001), using its Drizzle adapter so auth schema and work-graph schema live in the same migration chain

## Consequences

- **Raw SQL is a first-class citizen**: views, materialized projections, queue leasing, and append-only enforcement are written as SQL without fighting the ORM — the invariants of ADR-002 live where they belong.
- **Serverless-friendly by default**: Neon's driver works over HTTP/WebSocket from Vercel functions; no pooler sidecar needed at our scale.
- **One migration chain** covers Better Auth tables and the grammar-layer tables; auth schema changes are reviewed like any other schema change.
- **Cost accepted**: we lose the CRM's copy-pasteable Prisma precedent and Prisma's relation-query ergonomics. Mitigation: all writes go through `packages/brain` anyway, so ORM ergonomics matter far less than SQL fidelity — the write path is hand-written by construction.
- **Local development**: Neon branching doubles as the per-developer database story; a `docker compose` Postgres remains acceptable for offline work since Drizzle speaks plain Postgres.

## Alternatives considered

- **Prisma + Neon (the CRM stack)** — rejected: the relation API is pleasant but sits between us and the SQL features the work graph depends on; the engine binary also complicates serverless bundling.
- **Drizzle + a containerized Postgres (e.g. Railway/Supabase)** — rejected for now: Neon's branching and scale-to-zero fit the early phase; Drizzle keeps the door open to any Postgres later, since the coupling is to Postgres, not to Neon.
