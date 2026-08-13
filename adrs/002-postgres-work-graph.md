# ADR-002: Postgres as the work graph substrate, provenance enforced in the write path

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), with assisted analysis
- **Supersedes:** nothing — first substrate decision
- **Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) — agent work uses an atomic one-shot status claim; bounded queue leases remain direct-lane only
- **Amended by:** [ADR-019](019-human-approved-external-commitments.md) — executable proposals are task state, provider commitments are human-approved one-shot direct work, and tenant deletion cascades internal rows
- **Amended by:** [ADR-020](020-typed-decisions-and-impact-verification.md) — Decisions remain typed immutable Objects with trusted logical-head keys; impact judgments use a structural Action link and the existing tasks table

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

- `actors` (`human | agent | system` with a unique stable `actor_key`; each human maps one-to-one to the global Better Auth User through `user_id UNIQUE`, never to an organization membership), `intents`, `objects` (including closed-schema immutable Decision heads whose Object id is the version), `actions` (append-only during brand lifetime, with typed structural Intent/task/Decision/schedule links), `schedules` (human-configured registered product cadences), `tasks` (one-shot agent runs; bounded retry only for retry-safe direct/automatic work, namely transactional internal operations or side-effect-free idempotent external reads; human-approved one-shot external commitments), `credit_ledger` (append-only during brand lifetime)
- `actions.actor_id` and `objects.produced_by` are both NOT NULL. A deterministic integration acting as the content producer uses a narrowly scoped system Actor selected inside `packages/brain`; authenticated human boundaries retain their real human or explicitly transducing agent Actor and no operation may impersonate another producer
- `objects.produced_by → actions.id` is NOT NULL: provenance completeness is a schema constraint, 100% by construction
- Object content, provenance, and authorship are immutable. Supersession creates a new Object; the previous row may change only its lifecycle metadata from `active` to `superseded` and set `superseded_by` to the new Object in that same transaction
- Current state is an indexed query or ordinary SQL `VIEW` over canonical graph rows and the Action log. V1 has no PostgreSQL `MATERIALIZED VIEW`; any future projection cache is rebuildable and never canonical
- **A single write path**: `packages/brain` exposes typed functions that evaluate Policy, persist the `policy_snapshot`, and write each business Action plus its canonical Object/Intent/schedule/task mutation in one transaction. Agent tools and console routes all go through it. Deterministic insert-if-missing schedule-template reconciliation is the narrow non-authoring setup exception: it can create only disabled registry mirrors and can never configure, enable, or advance them. V1 `recordDecision` is human-only; when a roadmap Decision is measurable, that same transaction also creates its exact one-shot impact-verification task
- Every internal brand-scoped row has a real foreign-key path to `brands` with `ON DELETE CASCADE`. Tenant deletion is the lifecycle boundary for the otherwise append-only log; third-party resources are not deleted by that transaction

## Consequences

- **The six invariant needs of the ADE document become SQL.** Direction ("why does this exist?") is a backward traversal over foreign keys; memory is provenance; accountability distinguishes the initiating `Intent.author_actor_id` from the producing `Action.actor_id`, then follows Action → Object.
- **Canonical domain-row scoping is enforced where writes happen**: `packages/brain` requires and filters by trusted `brand_id`. Identity, current Member authorization, proxy isolation, and database same-brand integrity remain separate enforcement points owned by ADR-001, ADR-005, ADR-009, and ADR-014.
- **The cost: provenance is discipline, not substrate.** Git would have made violation impossible; Postgres merely makes it detectable. This is paid for with integrity tests in CI: provenance completeness = 100%, policy-snapshot replay, projection rebuildability, effect-signature coverage. Any deviation is a bug that fails the build.
- **Git remains the substrate of the code repository itself** — including these ADRs, which are normative objects versioned in the repo. The grammar dogfoods at the meta level even while the runtime store is Postgres.
- **Migration path preserved**: the Action log is exportable; if a future phase needs the per-object encrypted event store named by the ADE document, the append-only model carries over.

## Alternatives considered

Covered in Context. The hybrid option was the runner-up and was rejected because two canonical stores create a consistency problem that the grammar itself forbids: State and Trace must not be able to diverge.
