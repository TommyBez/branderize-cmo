# ARCHITECTURE.md

This document maps how branderize-cmo is put together, for humans and AI agents working in the repo. Keep it current as the codebase evolves: every structural change ships with a new ADR or with the supersession of an existing one.

## Project identification

- **Name:** `branderize-cmo`
- **Maintainer:** Tommaso
- **License:** TBD
- **Last updated:** 2026-08-12

## Overview

branderize-cmo is an **agent-native marketing team**: a team of agents — a CMO lead and six specialists — built on the [eve](https://eve.dev) framework, working on a *work graph* shared with humans instead of scattered communication across human-native apps. The center of the system is not the chat: it is the operational state of the work, with full provenance.

The project fuses five sources, each with a distinct role:

| Source | Role in the design |
| --- | --- |
| ADE agent-native document (v15, internal) | The ontology: Actor, Intent, Object, Action, Policy; work graph; provenance; proportional gate; effect signatures; the anti-metric |
| [eve 0.31.3](https://github.com/vercel/eve/blob/8e0bd60cd49246706a7ebdb8f7c84c3683048970/packages/eve/CHANGELOG.md) | The runtime: durability, ID-addressed sessions, sandboxes, channels, subagents, schedules, human-in-the-loop |
| [marketing-team-eve-template](https://github.com/vercel-labs/marketing-team-eve-template) | The tactical skeleton: lead + specialists, self-contained briefs, approval gates, MCP allowlists, artifact handoff by id |
| [trycompai/crm](https://github.com/trycompai/crm) | The operational discipline: no intelligence in the API, one-shot autonomous `AgentRun`s, idempotent actions, explicit run state and audit |
| [Magister](https://magistermarketing.com/) + [marketingskills](https://github.com/coreyhaines31/marketingskills) | The product horizon (multi-tenant SaaS, credits, self-serve onboarding) and the capability content (~44 marketing skills) |

The differentiator versus Magister is not the feature surface: it is the grammar. Every output has provenance, every decision is a normative object with supersession, every boundary action passes through a deterministic Policy. The system accumulates the judgment dataset by construction.

## Founding decisions

Architectural decisions are versioned normative objects in `adrs/` — the software ADR pattern generalized to all work, as the ADE document prescribes (§9). Nothing is deleted: it is superseded.

- [ADR-001 — Multi-tenant SaaS product](../adrs/001-multi-tenant-saas.md)
- [ADR-002 — Postgres as the work graph substrate](../adrs/002-postgres-work-graph.md)
- [ADR-003 — Web console as the primary surface; original in-app eve topology superseded](../adrs/003-web-console-eve-in-app.md)
- [ADR-004 — Extended roster of six specialists](../adrs/004-extended-roster.md)
- [ADR-005 — Drizzle + Neon for data access, Better Auth for authentication](../adrs/005-drizzle-neon-better-auth.md)
- [ADR-006 — Dual materialization: consultative subagents + standalone durable roots from a shared registry](../adrs/006-dual-declaration.md)
- [ADR-007 — Approvals and the tasks queue (external-commitment behavior amended by ADR-019)](../adrs/007-approvals-and-tasks-queue.md)
- [ADR-008 — Brain write-path rules, tool design, and model resolution](../adrs/008-brain-write-path-and-model-resolution.md)
- [ADR-009 — Standalone root-agent deployments and the console's data-surface discipline](../adrs/009-agent-deployment-and-console-data-surface.md)
- [ADR-010 — The plan is agentic synthesis with deterministic persistence](../adrs/010-plan-as-derivation.md)
- [ADR-011 — Operational invariants for agent work](../adrs/011-operational-invariants-for-agent-work.md)
- [ADR-012 — Contracts: one approval source, the brief schema, the intent lifecycle, Plan generation](../adrs/012-contracts-approval-brief-intents-compiler.md)
- [ADR-013 — The policy matrix, typed lateral edges, and sandbox rules on eve's real trust model](../adrs/013-policy-matrix-lateral-edges-sandbox.md)
- [ADR-014 — Schema: singleton keys, session ownership, derived structure, two streams, ledger granularity, content shape](../adrs/014-schema-singletons-sessions-streams-ledger.md)
- [ADR-015 — The registry: uniform agent shape, two-declaration deltas, self-copies, tool composition, task kinds, capability gating, the console as consumer](../adrs/015-the-registry.md)
- [ADR-016 — eve session ID and stream-cursor persistence on the owning record](../adrs/016-eve-session-state-persistence.md)
- [ADR-017 — Consultative subagents; durable specialist work enters through tasks](../adrs/017-consultative-subagents-durable-root-work.md)
- [ADR-018 — One-shot Eve sessions for durable agent tasks](../adrs/018-one-shot-durable-agent-tasks.md)
- [ADR-019 — Human-approved external commitments are direct tasks](../adrs/019-human-approved-external-commitments.md)
- [ADR-020 — Typed Decisions and one-shot impact verification](../adrs/020-typed-decisions-and-impact-verification.md)
- [ADR-021 — Plan advancement and human readiness override](../adrs/021-plan-advancement-and-human-readiness-override.md)

### Normative ownership

This file is the current architecture map, not a second protocol specification. When a summary here conflicts with an ADR, the latest explicit amendment controls. Detailed concurrency fixtures and transition rules live only with their owning ADR:

| Concern | Normative owner |
| --- | --- |
| Tenant identity, roles, and product mutations | ADR-001; database/auth adapter in ADR-005 |
| Agent topology and CMO proxy/session ownership | ADR-009 and ADR-016 |
| Work-graph model, replay receipt, and schema constraints | ADR-002 and ADR-014 |
| Intent lifecycle, brief, completion, and Plan publication boundary | ADR-012 |
| Policy signature and effect matrix | ADR-013 |
| Registry and capability composition | ADR-015 and ADR-017 |
| One-shot agent task lifecycle | ADR-018 |
| Human-approved external commitments and provider outcomes | ADR-019 |
| Typed Decisions and impact verification | ADR-020 |
| Same-Plan advancement, wake-up, and readiness override | ADR-021 |

Cross-references elsewhere intentionally state only the invariant needed by that section. They must not restate an owner's full lock protocol or test matrix.

## From the ADE grammar to eve primitives

| ADE primitive | Incarnation in branderize-cmo |
| --- | --- |
| **Actor** | A globally stable identity row in `actors` (`type: human \| agent \| system`). One Better Auth User maps to exactly one human Actor across every organization; membership and role remain separate Better Auth `Member` facts. Eve agents are first-class actors, while deterministic application integrations use narrowly named system actors rather than impersonating the initiating human or a specialist |
| **Intent** | The canonical current row in `intents`: immutable author, statement, typed acceptance criteria, typed constraints, lifecycle status, and monotonic revision. A current human's explicit request is transduced directly into an `active` revision-1 Intent; an autonomous agent idea is a `draft` proposal until a human adopts it. An explicit reply in an authenticated top-level CMO turn may likewise be transduced immediately into typed criteria/constraints without changing the author or adding a second approval. Low structure is not draft state. Refinement and adoption use compare-and-swap Actions rather than an upfront toll or an `intent_versions` lifecycle |
| **Decision** | A human-authored immutable Object selected from ADR-020's closed union (`roadmap_input \| policy_restriction \| model_override \| intent_preauthorization`). Trusted code derives its logical head key; replacement creates a new Object id and supersedes the exact previous head. Agents recommend but do not record active v1 Decisions |
| **Object** | A row in `objects` with `produced_by → actions.id` NOT NULL. On supersession the previous Object's `superseded_by` points to the new Object. Brand context, decisions, artifacts, reports |
| **Action** | A row in `actions` (append-only during the brand's lifetime): tool call, schedule run, human approval, execution receipt, or verification — always with a producing Actor, timestamp, rationale, and the relevant `policy_snapshot`; the initiating human belongs on the linked Intent or authorization Action rather than being mislabeled as producer |
| **Policy** | A pure function in `packages/policy`: (Actor identity, trusted authorization context — including the current organization Member role for a human —, effect signature, Intent structure level or explicit null) → allowed / requires-verification / requires-human-approval / denied. Null never fabricates Intent authority and is no more permissive than low |
| **State** | A derived query over the canonical graph and Action log. Never an independent object, never diverging from the Trace |
| **Verification** | A typed Action with three explicit subtypes: provider-outcome verification records what happened to an accepted external command; Intent-acceptance verification tests the exact criteria revision pinned by a task; Decision-impact verification compares measured marketing results with a Decision and may produce a judgment |
| **Context** | A query over `objects` given an Intent — not a file to pass around |

## Monorepo layout

Turborepo + pnpm. Current state: `apps/web` and `apps/app` are Next.js 16 boilerplate, `packages/ui` holds the shadcn components, Ultracite/Biome tooling.

Target:

```text
branderize-cmo/
  apps/
    web/                  # branderize public site — the team's first client is branderize itself (dogfooding)
    app/                  # console + one Vercel Cron fan-out; authenticated /eve/v1/* proxy only to agent-cmo
    agent-cmo/            # standalone eve root; bridge-authenticated CMO chat, six consultative subagents, thin local wrappers + custom dispatcher
    agent-product-marketer/ # standalone durable specialist root; thin local wrappers + custom dispatcher; default eve channel is local-dev-only
    agent-content/        # standalone durable specialist root; thin local wrappers + custom dispatcher; default eve channel is local-dev-only
    agent-distribution/   # standalone durable specialist root; thin local wrappers + custom dispatcher; default eve channel is local-dev-only
    agent-seo-discovery/  # standalone durable specialist root; thin local wrappers + custom dispatcher; default eve channel is local-dev-only
    agent-lifecycle/      # standalone durable specialist root; thin local wrappers + custom dispatcher; default eve channel is local-dev-only
    agent-growth/         # standalone durable specialist root; thin local wrappers + custom dispatcher; default eve channel is local-dev-only
  packages/
    ui/                   # shadcn/ui — the only source of UI
    db/                   # Drizzle schema/migrations + shared pg.Pool-backed Neon client (ADR-005)
    brain/                # the ONLY write path of the work graph + projection reads (rules: ADR-008)
    connections/          # brand-scoped Vercel Connect references + the shared trusted token resolver (ADR-008)
    policy/               # effect signatures → approval matrix as a pure function
    agents/               # canonical registry/definitions plus eve workspace-extension entrypoints for shared skills, tools, connections, instructions, and hooks; imported by thin agent-local wrappers and by the console (ADR-006, ADR-008, ADR-015, ADR-017)
    marketing-skills/     # submodule of coreyhaines31/marketingskills + materialization script
    env/                  # shared root .env loading
    typescript-config/
```

Every server-side application that accesses Postgres uses the same database package and adapter, not the same in-memory pool. `packages/db` creates one bounded, module-scoped `pg.Pool` per live Vercel Fluid Compute instance, points it at Neon's pooled runtime `DATABASE_URL`, and registers it with `attachDatabasePool`. Concurrent invocations on that instance reuse the pool; every additional scaled instance and every standalone deployment has its own pool. Neon PgBouncer and Postgres provide cross-instance connection management and serialization. `drizzle-kit` and migrations use the separate direct `DIRECT_DATABASE_URL`. Interactive write invariants run through `db.transaction(...)` and transaction-scoped locks only; no external provider call is made while such a transaction is open (ADR-005).

## The work graph: schema and invariants

Postgres is the only canonical store (ADR-002). Two layers:

**Product layer** — `organizations`, `users`, Better Auth `members`, `brands` (organization → many brands, the Magister model), and `brand_connections`. Every brand has one non-null `organization_id`. V1 tenant visibility is organization-wide: every exact `Member(organization_id, user_id)` may read the ordinary product projections of all brands in that organization, while its current `owner | admin | member | viewer` role is enforced per operation across them. Membership is not blanket mutation or CMO-turn authority. There is no Better Auth Team and no `brand_memberships` table. The global Better Auth User is also the identity anchor for exactly one human Actor; changing organization or role never creates another Actor. V1 exposes no hard account-deletion operation: offboarding removes the relevant Member rows and revokes sessions, while the User and Actor remain for historical attribution. Every authenticated boundary still requires a trusted `brand_id`, resolves its brand and organization, and validates that exact current Member and the role required by the operation; every domain query and invariant remains filtered by `brand_id`. Application and CMO-proxy boundaries reread that role per request instead of trusting a prior bridge JWT, browser state, or conversation/session binding. A viewer is read-only for ordinary brand product surfaces and authorized conversation reads. Its sole state-reducing exception is an exact-`turnId` cancel of a turn already observed in its own CMO conversation; cross-member conversation-transcript visibility remains a separate decision. A connection is owned by the brand, never by the Better Auth user who happened to connect it. In v1 OAuth is brokered only by Vercel Connect: the row stores the registered provider/slot, `connector_uid`, `installation_id`, effective external-account metadata/scopes, and lifecycle status, never an access token or refresh token. `installation_id` may be null only when that connector's contract has exactly one installation; a multi-installation connector requires it. A provider whose connector is intrinsically single-tenant receives a distinct connector per brand rather than sharing one connector across brands. A human connect/disconnect request requires the exact current Member of that brand's organization and sufficient organization-wide role, and records that human as the Actor, but no `owner_user_id` controls later headless use. One active selection per registered brand/provider slot is enforced in Postgres. Every brand-scoped row has a real foreign-key path to `brands`; deleting a brand cascades through all internal work data and credential references. Provider resources are outside that transaction and may remain orphaned (ADR-019). API-key and other non-OAuth credentials are outside this decision; any future row may hold only an opaque broker reference, not the secret itself.

**Grammar layer** — the work graph:

| Table | Contents |
| --- | --- |
| `actors` | Humans, agents, and deterministic application identities in the same table: `type`, globally unique `actor_key`, nullable `user_id`, handle, and non-human registry metadata. A human row has `user_id UNIQUE NOT NULL`, references the global Better Auth User with `ON DELETE RESTRICT`, and uses the derived key `human:<user_id>`; agent/system rows have `user_id IS NULL`. Actors carry neither `organization_id` nor `brand_id`. For humans this row is identity and audit attribution only: no Actor role authorizes an operation. The current human role comes from the exact Better Auth Member at the boundary; the brand-scoped Action's `policy_snapshot` freezes the organization role and verdict actually used. Fixed system actors such as `system:context-dev` are selected by exact trusted operations, never caller-supplied principals |
| `intents` | Canonical current `statement`, nullable non-empty typed `acceptance_criteria`, nullable non-empty typed `constraints`, immutable author, status (`draft → active \| abandoned`; `active → settled \| abandoned`), `parent_intent_id`, and monotonic `revision NOT NULL DEFAULT 1`. `draft` is reserved for agent-authored proposals awaiting human adoption; a human-authored request starts active even when statement-only. `structure_level` is **derived**, never stored; adoption/refinement history is in Actions and accepted execution input is in task snapshots, so there is no `intent_versions` table (ADR-012, ADR-014) |
| `objects` | `type` (brand_context, decision, evidence, artifact, move_candidate, marketing_plan, report…), immutable `content` JSONB + `content_text` (FTS) + one nullable `blob_key`, `singleton_key` with a partial unique index for singleton types, immutable `produced_by`, and lifecycle metadata `status` (active / superseded / dismissed) plus `superseded_by` from the previous Object to its replacement (ADR-008, ADR-014). Besides global primary key `id`, `UNIQUE(brand_id, id)` supports composite same-brand foreign keys. Every v1 Decision uses ADR-020's closed content union and a non-null trusted key (`roadmap`, `policy`, per-agent model, or exact-Intent preauthorization); its Object id is the version identity. Evidence and Move Candidates are collections: an Evidence key is a searchable/display label, never a unique head or relation identity, while every Move Candidate stores duplicate-free exact same-brand Evidence Object ids for the observations that originated it. `marketing_plan` is the single brand-level logical head: its closed content pins one Strategy and ordered Move Candidate/Evidence references, and each replacement Object id is a new version. The producing Action, rather than duplicating them in Plan content, stores the exact typed snapshots of every active Intent coordinated in that synthesis; those snapshots are provenance only and never Policy/common-origin input. A Plan move's Evidence ids mean the observations used in that synthesis and may differ from the candidate's immutable origin set; neither relation resolves by key. Closed Evidence includes the provider-independent, agent-authored `metric_observation`; closed Report includes `decision_recommendation`, which is review input rather than a pending Decision. Each binary variant is its own Artifact Object; documents reference typed artifact ids. An executable proposal is not an Object; it is a task (ADR-019) |
| `actions` | Append-only grammar log during brand lifetime: non-null `actor_id`, `type`, `rationale`, type-validated `payload` JSONB, `intent_id`, `task_id`, nullable same-brand `decision_id`, `effect_class`, `policy_snapshot`, authorization/result links, and `session_id`/`call_id` telemetry links. Canonical writes that promise exact replay additionally store a checked nullable pair `operation_key`/`request_hash`; trusted code namespaces the key, partial `UNIQUE(brand_id, operation_key) WHERE operation_key IS NOT NULL` is the database backstop, and a transaction advisory lock on the same brand/key makes concurrent first calls converge before resource/head checks. The producing Action is their durable replay receipt. Replay authenticates current tenant access and validates that receipt before current-head/write-Policy checks, so it returns the historical result rather than reapplying a mutation. `intent_declared` records human-origin declaration (with a CMO Action Actor when it performed chat transduction), `intent_proposed` records an autonomous agent draft, `intent_adopted` records the adopting human and expected/resulting revision while preserving the proposing agent as Intent author, `intent_refined` records the current statement plus typed before/after criteria/constraints, `intent_abandoned` records the guarded human terminal transition without cancelling accepted work, and human `intent_settled` records explicit closure of the exact active revision. Each shares its canonical-row transaction and exact replay receipt; an automatic acceptance Verification is instead its own task-bound settlement receipt. Plan progress uses a human `plan_move_readiness_overridden` Action and CMO `plan_wave_evaluated` Actions rather than mutable Move/wave state. Each wave Action has a subtype-unique task link and a canonical route mapping with nullable immutable root-routing Action/task provenance; observed lateral rows have no root provenance. Approval additionally freezes the external-effect cost bound and billing snapshot (`non_billable` or price key/version/currency/fixed unit amount). A commitment Result stores exactly one discriminated `accepted + receipt`, `rejected + code/message`, or `unknown + code/message` fact. A provider-outcome Verification links both that Result Action and the poll task that observed or classified it; an Intent-acceptance Verification cites the exact criteria revision it evaluated; a Decision-impact Verification structurally links the immutable Decision it judged. Intent adoption/abandonment/settlement, readiness override, Plan wave evaluation, Approval, cancellation, dismissal, external receipt, provider-outcome verification, Intent-acceptance verification, and Decision-impact verification are distinct facts |
| `session_events` | Unpartitioned raw Eve event log and telemetry for every root and child. Eve `meta.id` is the global primary key and deduplicates delivery; the complete reducer-consumable envelope/payload and an application ingestion sequence preserve observed replay order because the ULID is not a total-order cursor. Each row records the exact emitting `session_id` plus denormalized Eve lineage: `root_session_id` (the same id for a top-level session), nullable immediate `parent_session_id`, and nullable `parent_call_id`. The audit hook uses `INSERT ... ON CONFLICT DO NOTHING RETURNING`; every winning billable `step.completed` may produce its `model_charge`, while raw `compaction.requested`/`compaction.completed` remain telemetry only. A conversation transcript selects only rows whose exact emitting `session_id` equals `cmo_conversations.session_id`, orders them by ingestion sequence, and folds them through Eve 0.31.3's `defaultMessageReducer()`; it never selects by inherited conversation data or `root_session_id`. Those exact bound-root events are retained through the brand FK cascade for the brand lifetime. Child and other non-conversation telemetry may receive a future measured retention policy, but descendants do not inherit transcript retention. Hook delivery is best effort and alerts on persistence failure; snapshot/recovery does not reconcile missed rows, so the persisted fallback may have gaps (ADR-014, ADR-016) |
| `cmo_conversations` | Application-owned conversation identity and metadata; many may belong to one brand. Each has one `owner_user_id`, is created before its first send, and stores the Eve-generated immutable `session_id` plus the latest monotonic checkpoint of the browser-owned `stream_index`. Only that owner with current organization Member role `owner \| admin \| member` may create/send, answer HITL, checkpoint, compact, clear, reset, or perform related product mutations. The same owner after downgrade to `viewer` may still read its authorized transcript/snapshot/stream and may stop only an already observed turn with its exact `turnId`; it cannot supply later input. The browser `useEveAgent` store—not the row or proxy—owns the live writer `ClientSession`, cursor, stream consumption, and reconnect loop; the database checkpoint may lag and is never an authorization or reload-correctness boundary. The writer UI disables input while its client or recovered snapshot is working, and the viewer composer is always disabled. V1 deliberately has no cross-tab FIFO or server-side active-turn guard, so simultaneous sends by the same authorized owner are unsupported. Terminal transcripts remain readable from the retained exact-root `session_events` reduced on read, but are not rebound to a new Eve session. Read visibility for other members of that organization is a separate ACL decision (ADR-016) |
| `schedules` | Durable deterministic calendar rules, distinct from task occurrences: stable per-brand `schedule_key`, registry-validated `worker_key`/task kind and typed payload template, `daily \| weekly` cadence, local wall-clock time, optional weekday, IANA timezone, enabled flag, revision, `next_scheduled_for`, monotonic `coalesced_due_count NOT NULL DEFAULT 0`, and nullable `last_coalesced_for`. `UNIQUE(brand_id, schedule_key)` protects setup. The UTC next cursor is recomputed from the local calendar rather than fixed-minute intervals. Coalescing fields summarize suppressed due evaluations and are not a backlog. Rows are disabled rather than individually deleted and follow the brand cascade (ADR-009, ADR-014, ADR-018) |
| `tasks` | Durable work, proposal, and one-shot execution identity: `kind`, registry-derived `worker_key`, `execution_mode: agent \| direct`, `activation: automatic \| human`, typed kind `payload`, nullable same-brand `intent_id` plus immutable typed `intent_snapshot`, nullable same-brand `plan_object_id`/`move_candidate_id`, task `revision`, hashes, `subject_key`, ordinary creator `idempotency_key UNIQUE`, nullable paired `schedule_id`/`scheduled_for`, nullable registry-derived `commitment_conflict_key`, lifecycle timestamps including `approved_at`, status, outcome/error fields, approval/result Action links, and lineage (`parent_task_id`, `supersedes_task_id`, `retry_of_task_id`). `parent_task_id` is insertion-only trusted causation: a new route points to its routing task and every new task-bound lateral, recheck/self-successor, retry, replacement, or commitment points to its existing source; model/browser input cannot set it and observation/rescheduling cannot reparent a row. This produces a DAG by construction, with cycle-safe fail-closed reads as defence. Intent id/snapshot are null together; otherwise the snapshot contains the exact Intent revision, current statement, criteria, constraints, and only applicable immutable exact-Intent `intent_preauthorization` Object ids plus typed policy facts, and its id agrees with the relational FK. Plan/Move ids are also null together. A directly Plan-routed row has null Intent/snapshot, the exact validated Plan/Move pair, an authoritative rebuild/advancement routing task as parent, and a trusted subject `plan-route:<move_candidate_id>:<registered-subject>`; a row cannot carry both origin branches. The origin-free `advance-marketing-plan` coordinator instead pins the Plan and optional human-target Move in its closed trusted payload while those common-origin columns remain null. `(kind, brand_id, subject_key) WHERE status IN ('awaiting_approval', 'queued', 'running')` deduplicates ordinary active identities. Deterministic cadence occurrences must be `agent/automatic` and use an occurrence-scoped trusted subject, exact `UNIQUE(schedule_id, scheduled_for)` replay identity, plus partial `UNIQUE(schedule_id) WHERE schedule_id IS NOT NULL AND status IN ('queued', 'running')` so only one nonterminal occurrence survives per schedule. Human commitments use a proposal-specific subject so distinct proposals are not semantically collapsed. A separate partial unique conflict guard permits at most one serialized commitment per `(brand_id, commitment_conflict_key)` in `queued \| running`. Agent rows follow ADR-018's one task-mode run. Retry-safe direct/automatic kinds may retain bounded retry, but are limited to transaction-safe internal operations or side-effect-free idempotent external reads and never write externally. Human-approved external direct kinds follow `awaiting_approval → queued → running → succeeded \| failed \| outcome_unknown`, make at most one provider call, and never use lease reclaim. Other terminal outcomes include `cancelled`, `dismissed`, `superseded`, `expired`, and `needs_regeneration` (ADR-009, ADR-012, ADR-014, ADR-016, ADR-017, ADR-018, ADR-019, ADR-020, ADR-021) |
| `credit_ledger` | Append-only: `grant` / `model_charge` / `action_charge`. A model charge links one winning billable `step.completed` event through `session_event_id UNIQUE` and stores its gateway generation id when present, model, token usage, and actual cost. Eve 0.31.3 compaction lifecycle events never qualify: zero/N compaction provider calls expose no billable step usage/cost/generation id and are Branderize platform COGS outside credits. An action charge links `action_id UNIQUE` and stores the approved fixed amount, currency, and pricing version (ADR-014) |

For `intent_refined`, the Action distinguishes direct-human mutation from top-level CMO transduction, preserves the immutable Intent author, and stores trusted authorizer plus conversation/turn provenance. Its same-turn semantic receipt excludes Eve `call_id` from identity; ADR-012 and ADR-014 own the exact hash and CAS contract.

For an agent task, terminal `superseded` is reserved for ADR-012/ADR-021's guarded withdrawal of a queued root wave route explicitly excluded by a new Plan. Other agent work cannot enter that state.

Three invariants pay the provenance debt (Git would give these properties for free; here they are discipline):

1. **`objects.produced_by` is NOT NULL.** Every Object is born from an Action. Provenance completeness = 100%: any deviation is a bug, not an opinion.
2. **`actions` is append-only during a brand's lifetime; Object content and provenance are immutable.** Supersession creates a new immutable Object and changes only the prior row's lifecycle metadata in the same transaction. Tenant deletion is the explicit cascade boundary.
3. **A single write path.** Every console or agent mutation uses a typed `packages/brain` boundary that scopes tenant, evaluates Policy, records its snapshot, resolves exact replay before mutable-head guards, and commits each canonical fact atomically. Human-only, Intent lifecycle, Decision, Plan-publication, and Plan-advancement variants are owned respectively by ADR-001, ADR-012, ADR-020, and ADR-021; task failure never rolls back an earlier successful tool-level canonical write.

Current state (e.g. a brand's active brand context) is an indexed query, or an ordinary SQL `VIEW`, over the one active non-superseded Object of that type. The partial unique index on the active singleton identity makes the result unambiguous; v1 has no PostgreSQL `MATERIALIZED VIEW` to refresh after a write. Pending external approvals are direct tasks with `status = 'awaiting_approval'`; an Approval Action is appended only when the human clicks. The console's inbox is therefore a task query, not a separate domain object. Binary artifacts live in Vercel Blob at brand-scoped content-addressed keys. The server validates, hashes, and uploads bytes before the transaction creates the corresponding Artifact Object; documents contain typed artifact ids and upstream URLs remain evidence only. Upload-before-commit may leave an unreferenced Blob after DB failure, which v1 accepts, but canonical state can never point to bytes not yet stored. The console uses the authenticated Blob-delivery path (ADR-011, ADR-019).

## The agent team

One lead—the **CMO**—and six specialists share the registry defined by ADR-015. The CMO is the only natural-language transduction point. In an authenticated top-level human turn it may declare or refine the exact Intent identified by that request and may request durable work for an unambiguous active Intent; autonomous/task contexts can only propose drafts or inherit the origin of their current task. The full Intent creator and refinement contract belongs to ADR-012 and ADR-017.

### Two specialist modes (ADR-006, ADR-017)

Every specialist is materialized from one `{ shared, consultation, durable }` registry entry:

- **Consultation** is an in-process, read-only CMO subagent call. It may analyze trusted graph data and allowlisted external reads, but cannot write the graph, enqueue work, schedule, prepare a draft, approve, or execute a commitment. Its `ConsultationReturn` is advice, not canonical state.
- **Durable work** is a task claimed by that specialist's standalone root. The root accepts only generated `compiledSupportedKinds`, reloads the trusted brief, opens one task-mode Eve session, and follows ADR-018's one-shot lifecycle. Lateral work, rechecks, commitments, retries, and replacements become separate task rows; self-copies remain inside the accepted parent task and cannot settle it.

The common brief has exactly one trusted origin branch: an immutable active-Intent snapshot, exact Plan/Move references with null Intent, or a registered origin-free branch. Model-authored kind payloads cannot override that envelope. `TaskCompletion` contains the domain status, bounded summary, normalized selected `output_object_ids`, open questions, optional eligible Intent-acceptance judgment, and the registered kind result. Object inventory is always derived from `Object → producing Action.task_id`; task children are derived from `parent_task_id`, while Plan route adoption is read from producing/wave Action mappings. ADR-012 owns these contracts and ADR-015 owns required-output derivation.

Agent identity comes from the registry's build-time `actorKey`, not from the initiating principal. Consultation uses it only for telemetry; durable roots use it for canonical Action attribution. Every generated model-bearing wrapper applies the same model-resolution and Gateway-attribution factory, while the audit extension records exact Eve session lineage and winning billable steps. ADR-006, ADR-014, ADR-015, ADR-017, and ADR-018 own the detailed composition, session binding, replay, billing, and settlement rules.

### Skills packaging

`packages/marketing-skills` remains a git submodule of Haines' repo plus a materialization step that selects the right subset and **rewrites context-file references** (`.agents/product-marketing.md` → the `get_brand_context` tool reading the projection from the brain). The materialized capabilities are exposed from `packages/agents` through eve workspace-extension entrypoints and mounted by thin local wrappers instead of maintaining copied specialist trees. An extension may contribute skills, tools, connections, instruction fragments, and hooks. It does not carry `agent.ts` configuration or sandbox definitions; schedules and custom channels are root-only and also stay outside the extension. Cross-cutting skills such as writing quality and banned words use the same extension packaging.

### The Plan is agentic synthesis with deterministic persistence (ADR-010)

The Marketing Plan is CMO judgment inside a deterministic persistence boundary. A brand has one Strategy head and one Marketing Plan head even when several Intents are active. A Strategy's optional origin Intent is only causal provenance; the Plan is where the CMO coordinates the active portfolio. Evidence and Move Candidates use exact Object ids; one `rebuild-marketing-plan` task reads the current active Intents and chooses priorities, dependencies, exclusions, and the bounded internal/preparatory work it considers ready now. This is intentionally not a deterministic `Move → task` compiler.

`publishPlanAndRoute` is the atomic boundary owned by ADR-012: after replay lookup it validates the running rebuild, active Strategy, Plan head, exact references, one canonical ordered read of current active `{ intent_id, revision }` values, and registered routes. It commits the new immutable Plan, a producing Action with trusted typed planning Intent snapshots, the complete `created | observed` route mapping, and any permitted queued-root exclusions together. `TaskCompletion` references the resulting Plan; the Action receipt owns the planning provenance and detailed mapping.

Dependencies explain sequencing but do not gate task claims. Later work advances the same immutable Plan through ADR-021's `advance-marketing-plan`, whose wave Action records another exact route mapping without creating a Plan version. Terminal mapped work and qualifying same-origin descendants may only ring a best-effort wake-up bell; they do not prove Move readiness or completion. **Ricontrolla** recovers a missed/absorbed wake-up, while **Avvia comunque** overrides only the CMO's readiness judgment for one included Move.

`plan_needs_rebuild` is a projection, not Object status: it is true when the producing Action's Strategy is no longer current or its planning Intent `{ id, revision }` set differs from the current active set. Declaring/adopting/refining/settling/abandoning an active Intent can therefore require Rebuild; creating a draft proposal cannot. No mutation auto-enqueues global Plan work. Until an explicit Rebuild publishes a fresh Plan, Advance, Ricontrolla and Avvia comunque create no new wave; already routed/running work and commitments retain their lifecycle. Explicit exclusions can withdraw only queued root wave routes with proven `created` provenance. Every console command uses ADR-001's current non-viewer human mutation boundary. No Plan operation lowers ADR-019's separate human button for publish, send, spend, or any other external commitment.

## Policy: effect signatures, not tool lists

Risk is not classified semantically but by a **closed effect signature**: phase (`graph-internal | external-preparation | external-commitment`), class (`reversible-external | irreversible-external | communication | financial` where applicable), scope, and blast radius. The registry assigns it together with the exact renderer, handler, and connector operation; model payloads cannot choose any of them. Graph writes and registered create-only provider drafts are preparation. Schedule, publish, send, activate, spend, merge, pause, unpublish, cancel, and close are commitments.

`packages/policy` is the pure, deterministic function:

```text
(Actor identity, trusted authorization context, effect signature, Intent structure level | null)
  → allowed | requires-verification | requires-human-approval | denied
```

For a human decision, trusted application code builds the authorization context from the exact current Better Auth Member and includes its organization-wide role. For agents and fixed system integrations, the context contains only their registry-derived capability boundary. Policy never discovers a current human role from the Actor row itself.

Intent time is explicit. When authorizing genuinely new Intent-bound work or an exact-Intent `intent_preauthorization` Decision, Policy first requires the canonical current Intent be `active`, then reads its revision and only the applicable active preauthorization heads with `content.authorized = true`, derives `structure_level`, and freezes those Object ids/facts in the new task or Action snapshot. A draft has no structure authority and cannot receive preauthorization; an active false head records revocation and contributes nothing. Every non-Intent-bound boundary—an administrative brand Decision, brand-wide Strategy (even with a causal origin Intent), Plan-routed task, or registered origin-free task—records `structure_level = null` and no preauthorization; this branch is no more permissive than low, evaluates exact kind/effect and current restrictions directly, and never treats Strategy, Plan, the Plan Action's planning Intent snapshots, or origin-free work as authorization. Current brand `policy_restriction` heads are a separate restrict-only input reloaded at every new authorization, new-work, or graph-write Policy boundary and recorded in `policy_snapshot`; they never raise structure or authority. After a task row exists, execution and writes that fulfil its accepted contract consume its immutable common origin; a later refinement cannot change an Intent-bound objective, while Plan-routed work stays pinned to exact Plan/Move. A distinct follow-up, lateral, commitment, retry, or scheduled occurrence is a new-work boundary even when a running root requests it: an Intent-bound insertion requires the canonical Intent still be active, while a Plan-routed insertion preserves null Intent and the source Plan/Move pair. Only explicit Intent creation changes branch. Current role and restrictions remain current at new authorization/write boundaries; connection, capability, registry, deadline, and safety remain current at their defined preflights. ADR-019 is the explicit exception at execution: a queued human commitment uses its frozen click-time Approval grant and can be stopped only by a cancellation that wins before claim. An Intent-acceptance Verification requires a non-null snapshot and cites its exact `intent_id`/`intent_revision`; Plan-routed work cannot emit one or settle an Intent. Automatic or human settlement locks the Intent row, requires `status = active` plus that exact revision, moves it to `settled`, and increments once. If the same terminal task has staged a self-recheck, automatic acceptance settlement is resolved first: a winning close clears `next_*` and suppresses the successor, while a stale Verification falls through to the ordinary current active-Intent check. Adoption and refinement use the same row lock with status/revision guards and also bump the revision, so only one concurrent change can win; settlement likewise makes later mutation fail without a write.

The default verdicts are versioned data, not prompt discipline (ADR-013):

| effect class | low structure | medium | high |
| --- | --- | --- | --- |
| graph-internal | allowed | allowed | allowed |
| external-preparation | allowed | allowed | allowed |
| reversible-external commitment | requires-human-approval | requires-human-approval | requires-human-approval |
| communication commitment | requires-human-approval | requires-human-approval | requires-human-approval |
| irreversible-external commitment | requires-human-approval | requires-human-approval | requires-human-approval |
| financial commitment | requires-human-approval | requires-human-approval | requires-human-approval |

Exact-Intent preauthorizations may raise structure, while current brand-scoped Policy-restriction Decisions may only tighten defaults. Neither can lower the human-approval floor for an external commitment. V1 therefore offers no policy override that turns a publish, send, activation, spend, pause, unpublish, cancellation, or close into an unattended operation, and no organization-scoped Decision override. Human roles are organization-wide Better Auth Member roles: owner/admin approve everything, members approve non-financial commitments, and viewers are read-only and approve none. The only viewer state change is ADR-016's exact-`turnId` stop of an already observed CMO turn owned by that same current Member; it cannot create a task, Action, new turn, HITL answer, cursor checkpoint, or later authority. Policy reads the current Member role, never `actors.role`, and the Action snapshot preserves the evaluated role and verdict.

Capability composition enforces the result before prompts become relevant. Consultative specialists have no write operations. Durable roots may receive an authored, create-only external-draft operation for a registered provider staging primitive, but never a generic mutation or commitment operation. At a commitment boundary, CMO chat and autonomous roots create a direct task in `awaiting_approval` and continue; no eve session parks. The human click appends the final Approval Action and queues that same task. The responsible specialist application then performs the fixed connector call as deterministic code, without an LLM. Its `policy_snapshot` answers “who authorized exactly what?” (ADR-019).

The useful Magister refinement remains structural separation: preparation and commitment are different registered capabilities. A provider draft can be created without granting schedule/publish; a paused campaign can be prepared without granting activation; a PR draft can be prepared without granting merge. Because Eve can replay an interrupted tool step, each external-preparation operation is registered as provider-key idempotent, deterministically recoverable, or explicitly duplicate-safe. Duplicate-safe preparation is at-least-once and may leave harmless private drafts orphaned; if duplication could notify, publish, spend, or otherwise matter, preparation remains internal. The stronger Branderize rule is symmetric: the nominally safe direction (`pause`, `unpublish`, `cancel`, `close`) also requires the same human button. Policy UI may explain or tighten these boundaries, but it cannot enable unattended external commitment. The exact Better Auth Member and current organization-wide role are evaluated at that click; the resulting Approval Action remains a durable grant even if the approver is later removed or downgraded. Revocation is an explicit cancellation that must win before claim (ADR-010 as amended by ADR-019).

Sandbox discipline follows eve's trust model (ADR-013): external preparation leaves the building only through a registered create-only operation in the trusted app runtime, and external commitment only through the post-approval deterministic direct handler — never through sandbox commands. Consultative subagents use `deny-all` sandbox egress and reach external reads only through validated read operations. Durable roots may have per-specialist read allow-lists in their own sandbox definitions; credential brokering is reserved for authenticated reads. Domain allow-lists require the Vercel or microsandbox backend — Docker dev runs `deny-all`.

For MCP and OpenAPI connections, eve 0.31.3's `toolCall.providedArguments` may inject trusted `brand_id` or remote-account arguments from verified session context while hiding those keys from the model-facing schema. This is parameter control, not tenancy or credential ownership: eve connection principals are only `app` or `user`, not `brand`. A Better Auth user principal can authenticate the current caller but never becomes the durable owner of a provider grant. `apps/app` owns connection onboarding and verifies `Member(brand.organization_id, user_id)` plus the required organization-wide role; the claimed task or authenticated CMO turn carries a verified `brand_id`. `packages/connections` accepts only that trusted brand context, resolves the active `brand_connections` row, and calls the `@vercel/connect` SDK with `subject: { type: "app" }` plus its `installationId`. Eve dynamic `auth(ctx)`/authored read tools and deterministic direct handlers reuse this one resolver, so no deployment implements refresh or token storage independently. Connect owns OAuth token storage, refresh, and rotation; the application owns brand data scoping, organization ACLs, connector/installation selection, metadata, and lifecycle. Tokens never enter Postgres, task payloads, model-visible arguments, or session history. All seven Vercel projects must be linked to every connector required by their compiled connection/tool/handler surface so their project OIDC identity can use it; a missing link is a deployment configuration failure, not a fallback to user OAuth or a stored token. Shared Eve extensions may distribute the adapter, but they do not share process memory or credentials.

## Channels and surfaces

The web console (`apps/app`) is the primary view over the graph (ADR-003):

1. **Approval inbox** — `direct/human` commitment tasks in `awaiting_approval`; ADR-019 owns editing, click-time Policy, cancellation, one-shot execution, and provider outcomes.
2. **Open questions** — low-structure active Intents and incomplete recommendations; an unambiguous current human reply may be transduced through ADR-012, while Decisions require their distinct human boundary.
3. **Digest with citations** — a mechanical activity skeleton plus narrative whose Object references are validated.
4. **Graph browser** — backward traversal from any Object to its producing Action, Intent, and Decision context.
5. **Chat** — Intent transduction and conversation, never canonical state.

ADR-009 owns topology and proxy authorization; ADR-016 owns conversation/session binding and transcript recovery. In summary, `apps/app` exposes only the CMO, rereads the exact current organization Member for every route, verifies the application conversation owner and immutable Eve session binding, and classifies reads, mutations, and the narrow observed-turn viewer cancel before forwarding. Specialist roots are machine-only. A bridge JWT or knowledge of a session id never replaces current authorization.

Console routes contain no agent judgment: Server Components read projections and Server Actions call typed `packages/brain` boundaries. The deterministic Context.dev onboarding adapter is the named integration exception and still commits through the brain. `brand_id` is explicit, SQL owns filtering/sorting, background work is polled while active, and optional capability gaps are visible as counters.

## Data flow: the onboarding loop

The product wedge — the first full turn of the flywheel:

```text
self-serve signup → org + brand with website_url + human-authored active rev.1 onboarding Intent
  → apps/app Server Action: context.dev Brand API for the brand kit (logo, colors,
    fonts, styleguide, socials) + site crawl to markdown; mirror validated binary
    variants to Blob first, then atomically commit their Artifact Objects and
    Brand Context v0 through packages/brain as system:context-dev (ADR-012)
  → persistent CMO conversation: consult product-marketer read-only and ask the user
    what the web cannot tell (goals, taste, constraints)
    → an explicit unambiguous reply immediately uses refineIntent; ambiguity asks again;
      explicit human Decision recording remains a separate boundary
    → a new one-shot product-marketer task enriches/supersedes Brand Context;
      if facts are still missing it terminates partial/blocked with open questions
    → cmo: recommends the first roadmap inputs; the human records the Strategy Decision
      and atomically creates its first rebuild-marketing-plan task
    → cmo task: interprets that exact brand-wide Strategy, current active Intents,
      and current Evidence/Move Candidates; records any missing Evidence and typed
      Move Candidates it needs, then atomically
      publishes the provenance-bound first-week Marketing Plan with all selected
      internal/preparatory routes; external commitments still wait for the button
      (ADR-010, ADR-019)
  → commitment tasks land in the approval inbox
    → the human approves / edits
  → the first Decisions enter the graph: the loop is closed
```

## Schedules and the feedback loop

There are three distinct mechanisms, deliberately not collapsed into one scheduler:

- **Agent recheck** — ADR-017 owns the typed `scheduleRecheck` tool, immediate cross-kind booking, success-coupled self-successor, origin preservation, and active-Intent check.
- **Product cadence** — ADR-014 owns durable daily/weekly `schedules`, local-time/DST semantics, cursor CAS, single active occurrence, coalescing without backlog, and exact occurrence replay.
- **Wake and dispatch** — ADR-009 owns the payload-free Vercel Cron fan-out; ADR-018 and ADR-019 own the agent, retry-safe direct, and human-commitment execution lanes. Postgres—not a process-local guard—serializes lifecycle changes.

An accepted external command may create a same-root origin-free provider-outcome poll only when its registry contract supplies durable lookup and bounded cadence; ADR-019 owns that deterministic read lifecycle. Marketing impact is separate: ADR-020's measurable Decision creates one future origin-free Growth task whose model may choose any available measurement read tools and records a typed Verification Action. Intent acceptance remains the independent exact-revision Verification owned by ADR-012. None of these mechanisms silently reopens an Intent, retries an ambiguous external commitment, or turns a Plan dependency into a dispatcher predicate.

## Credits

The Magister model: a monthly credit pool per plan, billable model consumption recorded locally only from winning `step.completed` usage emitted by Eve, action consumption priced by registered type, and overage at a unit price. The `credit_ledger` is append-only: even billing speaks the grammar. AI Gateway Custom Reporting compares total attributed spend by brand/feature, including expected classified platform COGS such as compaction, but never mutates that ledger.

Three nested commercial/work budgets (ADR-011): the plan allowance gates admission, the brand's monthly pool supplies the recorded balance, and each task gets a soft work budget selected by Policy — autonomous runs get less. At a recorded balance of zero or below, agent tasks stay queued and the console shows the work waiting on credits. There are no credit reservations: concurrent roots can admit work against the same positive snapshot, and each winning billable `step.completed` posts its own `model_charge`, so already-running work may take the ledger negative and block later claims until replenished or settled. A persistent CMO conversation does not wait for session closure: every billable step generation is charged as it completes, and a tool-using turn may legitimately create several charges. Automatic or manual compaction is deliberately outside this commercial meter: Eve may make zero/N summary calls, its raw lifecycle events remain telemetry, and Branderize absorbs any provider cost without `model_charge`, credit consumption, or admission adjustment. The gate is deliberately absent from both deterministic direct lanes. In particular, an approved `direct/human` commitment executes at zero pool balance. Only billable `succeeded` with a stable receipt records exactly one `action_charge` and may drive the balance further into paid overage; every unsuccessful or ambiguous outcome is uncharged. A specialist that notices its soft budget ending may deliberately save an Object and stage `TaskCompletion(partial)`. Separately, each root's static Eve token cap is a high safety fuse: it cannot be set per task through `send()`, and hitting it in task mode is a technical `failed`, not a fabricated partial result.

## Integrity metrics (CI)

CI enforces the owners' contracts rather than duplicating their complete test suites here:

- **Graph and tenant integrity** — every Object has a producing Action/Actor; every brand-scoped relation is same-brand and cascade-connected (ADR-002, ADR-014).
- **Identity, role, and session integrity** — current Member checks, viewer restrictions, conversation ownership, session binding, and exact-root transcript reconstruction are fail-closed (ADR-001, ADR-009, ADR-016).
- **Replay and Intent integrity** — stable operation receipts converge; lifecycle CAS has one winner; task snapshots are immutable and only active Intents originate new Intent-bound work (ADR-012, ADR-014, ADR-017).
- **Task and output integrity** — one-shot root settlement, root-only `finishTask`, normalized required outputs, exact-task Object provenance, and graph-derived child/inventory queries hold (ADR-015, ADR-018).
- **Policy and commitment integrity** — effect signatures are total, restrictions never expand authority, click-time Approval freezes the grant, and external commitments make at most one provider call with conservative unknown outcomes (ADR-013, ADR-019).
- **Decision and Plan integrity** — typed human Decision heads, brand-wide Strategy semantics, exact active-Intent planning snapshots without Policy leakage, atomic Strategy-derived work, exact Evidence references, atomic Plan publication, wave mappings, exclusions, and best-effort advancement satisfy ADR-010, ADR-012, ADR-020, and ADR-021.
- **Schedule and billing integrity** — cadence materialization coalesces correctly across races/DST, and only winning billable steps or successful priced actions enter the ledger; compaction stays classified platform COGS (ADR-009, ADR-014, ADR-018, ADR-019).

Detailed positive, negative, replay, and race fixtures remain normative in those ADRs. A new fixture is added to the owner, not copied into this list.

## Roadmap

- **Phase 0 — Product foundations**: `packages/db` + `packages/brain` + `packages/policy`; auth (Better Auth, Google) with orgs/brands; server-side Context.dev ingestion in `apps/app`; `agent-cmo` plus the six standalone specialist root apps, shared registry materialization, CMO-only console proxy, and the Next.js cron fan-out; CMO-guided product-marketer refinement after the deterministic baseline; console v0 = intent entry + object browser
- **Phase 1 — The team that delivers**: + content, distribution, seo-discovery; Notion/Typefully connections with effect-signature allowlists; approval inbox; artifact handoff by id
- **Phase 2 — The habitable graph**: supersession UI for Decisions, digest with citations, live tasks queue, first schedule (daily brief), and the versioned agent-generated Plan surface with Rebuild, same-Plan Advance/Ricontrolla, per-Move Avvia comunque, and open questions
- **Phase 3 — Feedback loop**: lifecycle + Resend; analytics connection; Verification Actions; credits and billing
- **Phase 4 — Scale**: growth's already-standalone root gains its ads credentials; MCP server channel (read by default, scoped writes, approval polling) + agent-native signup; public self-serve launch. Per-brand dedicated agent deployments stay possible via the `brand → agent endpoint` lookup (ADR-010)

## References

| Link | Covers |
| --- | --- |
| [eve documentation](https://eve.dev/docs/introduction) | The framework: agents, subagents, skills, channels, schedules, HITL |
| [marketing-team-eve-template](https://github.com/vercel-labs/marketing-team-eve-template) | The tactical precedent: `agent/` layout, approval matrix, credential model |
| [trycompai/crm](https://github.com/trycompai/crm) | The operational precedent: work queue, deny-all sandbox, autonomous agent |
| [marketingskills](https://github.com/coreyhaines31/marketingskills) | The marketing capability taxonomy |
| [Magister](https://magistermarketing.com/) | The product benchmark |
| [Drizzle ORM](https://orm.drizzle.team/) | Schema, queries, migrations; canonical runtime adapter is `drizzle-orm/node-postgres` (ADR-005) |
| [Neon](https://neon.tech/) | Serverless Postgres; pooled runtime URL plus direct migration URL (ADR-005) |
| [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute) | Concurrent function runtime; module-scoped pools use `attachDatabasePool` (ADR-005) |
| [Better Auth](https://better-auth.com) | Authentication, with the Drizzle adapter (ADR-001, ADR-005) |
