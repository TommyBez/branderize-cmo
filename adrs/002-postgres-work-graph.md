# ADR-002: Postgres as the work graph substrate, provenance enforced in the write path

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), with assisted analysis
- **Supersedes:** nothing — first substrate decision

## Context

The ADE document (§15) prescribes **literal Git** as the canonical substrate of the experimental phase: an append-only, content-addressed DAG gives provenance, supersession, and auditability for free. It also names an explicit migration trigger: *when per-object confidentiality becomes a requirement*, move to a per-object encrypted event store — "Git with encryption is not an honest option".

ADR-001 (multi-tenant SaaS) pulls that trigger on day zero: one brand brain per customer means per-tenant isolation is a launch requirement, not a future concern.

The options on the table:

- **Pure Git** — maximum fidelity to the ADE document; does not survive multi-tenancy, and graph queries become file-system walks.
- **Hybrid** — Git for the brand brain, Postgres for queue and projections; two canonical stores to keep consistent, and tenancy still unsolved for the brain.
- **Vercel Blob only** (the [template](https://github.com/vercel-labs/marketing-team-eve-template) pattern: "there is no application database") — fastest to start; no graph queries, no relational invariants, no tenancy enforcement.
- **Postgres + work queue** (the [CRM](https://github.com/trycompai/crm) pattern) — proven in production on the same framework; provenance must be designed into the schema by hand.

## Decision

**Postgres is the only canonical store.** The work graph is a schema, not a filesystem:

- `actors`, `intents`, `objects`, `actions` (append-only), `tasks` (queue leased with `FOR UPDATE SKIP LOCKED`), `credit_ledger` (append-only)
- `objects.produced_by → actions.id` is NOT NULL: provenance completeness is a schema constraint, 100% by construction
- Objects are never mutated; supersession is a new Object with `superseded_by` pointing at the previous one
- Current state is a **projection** (materialized view) over the Action log; projections are rebuildable caches, never canonical
- **A single write path**: `packages/brain` exposes typed functions that evaluate Policy, persist the `policy_snapshot`, and write Action + Object in one transaction. Agent tools and console routes all go through it

## Consequences

- **The six invariant needs of the ADE document become SQL.** Direction ("why does this exist?") is a backward traversal over foreign keys; memory is provenance; accountability is the Actor → Action → Object chain.
- **Tenancy is enforced where the writes happen**: `brand_id` scoping lives in `packages/brain`, one place to audit.
- **The cost: provenance is discipline, not substrate.** Git would have made violation impossible; Postgres merely makes it detectable. This is paid for with integrity tests in CI: provenance completeness = 100%, policy-snapshot replay, projection rebuildability, effect-signature coverage. Any deviation is a bug that fails the build.
- **Git remains the substrate of the code repository itself** — including these ADRs, which are normative objects versioned in the repo. The grammar dogfoods at the meta level even while the runtime store is Postgres.
- **Migration path preserved**: the Action log is exportable; if a future phase needs the per-object encrypted event store named by the ADE document, the append-only model carries over.

## Alternatives considered

Covered in Context. The hybrid option was the runner-up and was rejected because two canonical stores create a consistency problem that the grammar itself forbids: State and Trace must not be able to diverge.
