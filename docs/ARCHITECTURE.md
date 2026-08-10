# ARCHITECTURE.md

This document maps how branderize-cmo is put together, for humans and AI agents working in the repo. Keep it current as the codebase evolves: every structural change ships with a new ADR or with the supersession of an existing one.

## Project identification

- **Name:** `branderize-cmo`
- **Maintainer:** Tommaso
- **License:** TBD
- **Last updated:** 2026-08-10

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
- [ADR-010 — The plan is a derivation, and other lessons from the Magister product](../adrs/010-plan-as-derivation.md)
- [ADR-011 — Operational invariants for agent work](../adrs/011-operational-invariants-for-agent-work.md)
- [ADR-012 — Contracts: one approval source, the brief schema, the intent lifecycle, plan-compiler inputs](../adrs/012-contracts-approval-brief-intents-compiler.md)
- [ADR-013 — The policy matrix, typed lateral edges, and sandbox rules on eve's real trust model](../adrs/013-policy-matrix-lateral-edges-sandbox.md)
- [ADR-014 — Schema: singleton keys, session ownership, derived structure, two streams, ledger granularity, content shape](../adrs/014-schema-singletons-sessions-streams-ledger.md)
- [ADR-015 — The registry: uniform agent shape, two-declaration deltas, self-copies, tool composition, task kinds, capability gating, the console as consumer](../adrs/015-the-registry.md)
- [ADR-016 — eve session ID and stream-cursor persistence on the owning record](../adrs/016-eve-session-state-persistence.md)
- [ADR-017 — Consultative subagents; durable specialist work enters through tasks](../adrs/017-consultative-subagents-durable-root-work.md)
- [ADR-018 — One-shot Eve sessions for durable agent tasks](../adrs/018-one-shot-durable-agent-tasks.md)
- [ADR-019 — Human-approved external commitments are direct tasks](../adrs/019-human-approved-external-commitments.md)

## From the ADE grammar to eve primitives

| ADE primitive | Incarnation in branderize-cmo |
| --- | --- |
| **Actor** | A row in `actors` (`type: human \| agent`). eve agents (lead + specialists) are first-class actors: identity, scope, capabilities, audit |
| **Intent** | A row in `intents`. Born valid with the minimal core (author + statement); structure (acceptance criteria, constraints) is delegable work that unlocks autonomy, not an upfront toll |
| **Object** | A row in `objects` with `produced_by → actions.id` NOT NULL and `superseded_by → objects.id`. Brand context, decisions, artifacts, reports |
| **Action** | A row in `actions` (append-only during the brand's lifetime): tool call, schedule run, human approval, execution receipt, or verification — always with author, timestamp, rationale, and the relevant `policy_snapshot` |
| **Policy** | A pure function in `packages/policy`: (Actor, effect signature, Intent structure level) → allowed / requires-verification / requires-human-approval / denied |
| **State** | A projection (materialized view) over the Action log. Never an independent object, never diverging from the Trace |
| **Verification** | A typed Action with two explicit subtypes: provider-outcome verification records what happened to an accepted external command; Decision-impact verification compares measured marketing results with a Decision and may produce a judgment |
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
    policy/               # effect signatures → approval matrix as a pure function
    agents/               # canonical registry/definitions plus eve workspace-extension entrypoints for shared skills, tools, connections, instructions, and hooks; imported by thin agent-local wrappers and by the console (ADR-006, ADR-008, ADR-015, ADR-017)
    marketing-skills/     # submodule of coreyhaines31/marketingskills + materialization script
    env/                  # shared root .env loading
    typescript-config/
```

Every server-side application that accesses Postgres uses the same database package and adapter, not the same in-memory pool. `packages/db` creates one bounded, module-scoped `pg.Pool` per live Vercel Fluid Compute instance, points it at Neon's pooled runtime `DATABASE_URL`, and registers it with `attachDatabasePool`. Concurrent invocations on that instance reuse the pool; every additional scaled instance and every standalone deployment has its own pool. Neon PgBouncer and Postgres provide cross-instance connection management and serialization. `drizzle-kit` and migrations use the separate direct `DIRECT_DATABASE_URL`. Interactive write invariants run through `db.transaction(...)` and transaction-scoped locks only; no external provider call is made while such a transaction is open (ADR-005).

## The work graph: schema and invariants

Postgres is the only canonical store (ADR-002). Two layers:

**Product layer** — `organizations`, `users`, `brands` (org → many brands, the Magister model), and `brand_connections`. A connection is owned by the brand, never by the Better Auth user who happened to connect it: the row identifies the registered provider/slot, the application-managed credential or installation reference, the effective external account metadata/scopes, and lifecycle status. A human connect/disconnect request still requires current brand membership and records that human as the Actor, but no `owner_user_id` controls later headless use. One active selection per registered brand/provider slot is enforced in Postgres. Every brand-scoped row has a real foreign-key path to `brands`; deleting a brand cascades through all internal work data and credential references. Provider resources are outside that transaction and may remain orphaned (ADR-019).

**Grammar layer** — the work graph:

| Table | Contents |
| --- | --- |
| `actors` | Humans and agents in the same table: `type`, handle, role, capabilities |
| `intents` | Statement, author, status (`draft → active → settled \| abandoned`), `parent_intent_id`; `structure_level` is **derived**, never stored (ADR-014) |
| `objects` | `type` (brand_context, decision, evidence, artifact, move_candidate, report…), `content` JSONB + `content_text` (FTS) + `blob_key`, `singleton_key` with a partial unique index for singleton types, `produced_by`, `superseded_by`, lifecycle `status` (active / superseded / dismissed — ADR-008, ADR-014). An executable proposal is not an Object; it is a task (ADR-019) |
| `actions` | Append-only grammar log during brand lifetime: `actor_id`, `type`, `rationale`, `intent_id`, `task_id`, `effect_class`, `policy_snapshot`, authorization/result links, and `session_id`/`call_id` telemetry links. Approval additionally freezes the external-effect cost bound and billing snapshot (`non_billable` or price key/version/currency/fixed unit amount). A commitment Result stores exactly one discriminated `accepted + receipt`, `rejected + code/message`, or `unknown + code/message` fact. A provider-outcome Verification links both that Result Action and the poll task that observed or classified it. Approval, cancellation, dismissal, external receipt, provider-outcome verification, and Decision-impact verification are distinct facts |
| `session_events` | Telemetry stream: every eve event ingested by the audit hook, keyed on eve's `meta.id` (`ON CONFLICT DO NOTHING`); monthly partitions; retention is a policy knob (ADR-014) |
| `cmo_conversations` | Application-owned conversation identity and metadata; many may belong to one brand. Each has one `owner_user_id`, who is its only writer, is created before its first send, and stores the eve-generated immutable `session_id` plus `stream_index`. The index is only the next event cursor, not a public continuation token or an opaque session-state JSON document. Terminal transcripts remain readable but are not rebound to a new eve session. Cross-member read visibility is a separate ACL decision (ADR-016) |
| `chat_messages` | Permanent projection of `message.*` events scoped by both `brand_id` and `conversation_id` — the console renders chat from our DB, not from eve (ADR-014) |
| `tasks` | Durable work, proposal, and execution identity: `kind`, registry-derived `worker_key`, `execution_mode: agent \| direct`, `activation: automatic \| human`, typed `payload`, `revision`, hashes, `subject_key`, creator/occurrence `idempotency_key UNIQUE`, nullable registry-derived `commitment_conflict_key`, lifecycle timestamps including `approved_at`, status, outcome/error fields, approval/result Action links, and lineage (`parent`, `supersedes`, `retry_of`). `(kind, brand_id, subject_key) WHERE status IN ('awaiting_approval', 'queued', 'running')` deduplicates active identities; human commitments use a proposal-specific subject so distinct proposals are not semantically collapsed. A separate partial unique conflict guard permits at most one serialized commitment per `(brand_id, commitment_conflict_key)` in `queued \| running`. Agent rows follow ADR-018's one task-mode run. Retry-safe direct/automatic kinds may retain bounded retry, but are limited to transaction-safe internal operations or side-effect-free idempotent external reads and never write externally. Human-approved external direct kinds follow `awaiting_approval → queued → running → succeeded \| failed \| outcome_unknown`, make at most one provider call, and never use lease reclaim. Other terminal outcomes include `cancelled`, `dismissed`, `superseded`, `expired`, and `needs_regeneration` (ADR-009, ADR-016, ADR-017, ADR-018, ADR-019) |
| `credit_ledger` | Append-only: `grant` / `session_charge` / `action_charge`. An action charge links `action_id UNIQUE` and stores the approved fixed amount, currency, and pricing version (ADR-014) |

Three invariants pay the provenance debt (Git would give these properties for free; here they are discipline):

1. **`objects.produced_by` is NOT NULL.** Every Object is born from an Action. Provenance completeness = 100%: any deviation is a bug, not an opinion.
2. **`actions` is append-only during a brand's lifetime; Objects are never mutated, they are superseded.** A Decision is an Object with `type='decision'` and status active/superseded; supersession is a new Object pointing at the previous one. Tenant deletion is the explicit lifecycle boundary: `ON DELETE CASCADE` removes all internal brand data rather than retaining an unusable partial audit trail.
3. **A single write path.** `packages/brain` exposes typed functions (`declareIntent`, `produceObject`, `recordDecision`, `scheduleRecheck`, …) that, in one transaction, evaluate the Policy, persist the `policy_snapshot`, and write Action + Object. The agents' eve tools and the console routes all go through it. No direct writes anywhere else.

Current state (e.g. a brand's active brand context) is a **projection**: a materialized view over the latest non-superseded Object of that type. Pending external approvals are direct tasks with `status = 'awaiting_approval'`; an Approval Action is appended only when the human clicks. The console's inbox is therefore a task query, not a separate domain object. Binary artifacts (images, video, PDFs) live in content-addressed blob storage — the key carries the byte hash, so re-runs are idempotent; the Object holds metadata plus the blob key, and the console renders via short-lived signed URLs (ADR-011, ADR-019).

## The agent team

One lead — the **CMO** — and six specialists (ADR-004). The lead loads the brand context and preferences, structures the incoming intent, and chooses between two mechanisms: immediate read-only consultation with one specialist, or a durable task for one specialist root. A new consultation or task starts in an isolated specialist context and inherits no CMO history, so its input carries everything. Every agent task reloads its task and graph artifacts, then its root's custom dispatch channel starts one eve task-mode run with `from(taskAddress).send(...)`, where the channel-local address is derived from the trusted task id. `session.started` and the returned fixed handle both try to bind the authoritative `session_id` before normal work proceeds. Only the documented unbound-delivery recovery may call `send` again; a task with a bound session never does. A later product retry is a new task and fresh session, never continuation of the failed run (ADR-016, ADR-018). Specialists have no declared specialist children. Durable roots may use self-copies within their current task and request separate specialist work through typed lateral tasks rather than hidden nested delegation.

The CMO's job list is explicit (ADR-011): transduction of human chat into structured intents, routing with self-contained briefs, synthesis of specialist outputs back to the human, proposing roadmap-input Decisions, and the daily brief narrative. It does not author plans (ADR-010) and owns no special schedule — the daily brief is a task kind dispatched to the CMO root agent like any other.

Durable work uses a zod brief schema per task kind, not a phrase (ADR-012): it carries the intent id, the size-capped brand-context preamble, artifact references **by id**, the constraints from active Decisions, the capabilities snapshot, the session budget, and a brain `output_contract` declaring which Object types the root session may produce — the write path rejects the rest. `TaskCompletion` reports `completed | partial | blocked`, a token-capped summary, produced Object ids, ids of follow-up tasks already created, and open questions: never full artifact bodies. A staged self-recheck has no id until successful settlement creates or observes its successor and is therefore omitted from that array. A deterministic `finishTask` tool obtains `task_id` from trusted session context, validates the registered contract and referenced outputs, and stages the canonical result. The root returns the same output schema, but `result.completed` is telemetry and cannot replace the staged value; only `session.completed` with that value normally settles execution as `succeeded`. All three domain statuses are deliberate outcomes under that execution status. Technical failure is terminal `failed`, never synthetic `blocked` or automatic redispatch.

Consultation has a separate, configured `ConsultationReturn`: summary, recommendations, source references, suggested work, and open questions. It has no produced Object ids or claimed follow-ups because the declared subagent cannot write either. eve's caller-selectable `outputSchema` is useful structure, not the security boundary; the hard boundary is the generated read-only tool surface, and promoted consultation data is validated again.

### Two specialist modes (ADR-006, ADR-017)

Every specialist is declared twice from one shared definition in `packages/agents/registry.ts`:

- **Consultative lane** — a declared subagent of the CMO: in-process, low-latency, session-bound analysis with native control-plane events. It can read brand/graph context and use explicitly allowlisted external reads. It cannot mutate the graph, enqueue or schedule work, prepare an external draft, approve or execute a commitment, or call an externally effectful operation. Its sandbox has `deny-all` egress; brokered read tools are the only external path.
- **Durable task lane** — the specialist's standalone root app/deployment, activated only by its own tasks-queue dispatcher after an atomic claim of a row whose `worker_key` names that root and whose kind is in that deployment's generated `compiledSupportedKinds`. The dispatcher is an authored custom channel with an authenticated `POST /internal/dispatch` route; after claim it uses the route-scoped `from(taskAddress).send(..., { auth: taskAuth, mode: "task" })`. `taskAuth` is constructed from the claimed row and carries its verified brand context; it is never request- or model-authored. The root reloads the authoritative brief from Postgres. Each specialist separately authors `agent/channels/eve.ts` as `eveChannel({ auth: [localDev()] })`, so `/eve/v1/session*` and `/eve/v1/info` support local tooling but return `401` in production, while `/eve/v1/health` stays public. Public and user-facing routes cannot supply a replacement brief or invoke a specialist root directly.

The declarations share specialist identity, core instructions, skills, model defaults, and `actorKey`; they deliberately differ in authority, tool/connection composition, sandbox/egress policy, input/return contract, and mode addendum. `packages/agents` remains the canonical source, and each root or declared subagent uses a thin local wrapper to select and mount the appropriate generated surface. Eve workspace extensions carry only the reusable skills, tools, connections, instruction fragments, and hooks. Agent configuration and sandbox policy remain consumer-local; schedules and custom channels are root-only and remain in the root wrappers. None is implied by an extension mount. Registry materialization produces `consultTools` plus deny-all sandbox egress for declared subagents, and `workTools` plus the specialist root's sandbox policy for named roots. CMO self-copies inherit the same consultative specialist surface as the CMO; specialist-root self-copies inherit the parent root's work surface and remain inside its already-dispatched, already-budgeted task. A copy never widens authority.

Actor identity is a build-time constant of the shared definition (`actorKey`), not a runtime session property. Consultation sessions carry that identity in eve telemetry and the credit ledger but create no grammar Actions. Durable roots use it for `actions.actor_id`, while `intents.author_actor_id` records who authorized the work (the human or the originating Decision). Autonomous credit spend is capped by a global per-plan Policy; Decisions may only restrict it further.

Only durable work deduplicates, and it does so before any specialist root starts. The CMO's authored `request_specialist_work({ kind, payload })` and autonomous producers call `enqueueOrObserveTask`. Trusted code validates the payload, resolves the specialist, and derives `subject_key`; neither it nor `brand_id` is model-authored. Postgres arbitrates active work with `(kind, brand_id, subject_key) WHERE status IN ('awaiting_approval', 'queued', 'running')`. Ordinary agent and scheduled work use semantic subject identities; human commitment proposals use `commitment:<task_id>`, so independently intended proposals never coalesce merely because their target or payload resembles another. A separate nullable conflict key, derived by the registry only for stateful non-commutative commitments, excludes simultaneous approved commands on one target without changing those proposal identities or promising FIFO order. The task's unique creator/occurrence key and canonical request hash make replay of that creation return the same row and reject key reuse with different input; enqueue resolves this key before active-work identity so the historical replay wins even if another equivalent row is active. A genuinely new retry or schedule occurrence uses a new key and task id. V1 stores no alias for a distinct request that only observed or rescheduled an already-active row: the caller receives that task id, but a lost response followed by retry after settlement may create new work. Immediate work and its future recheck are distinct registered kinds so a scheduled booking cannot suppress work requested now. Future bookings use `scheduleRecheck`: the model supplies bounded due time, typed payload, and rationale, while trusted context and registry code derive all identity fields. An equivalent running self-recheck stages one `next_*` tuple with `UPDATE ... WHERE id = current_task_id AND status = 'running' RETURNING`; zero rows means `task_closed`. Concurrent valid schedulers replace that tuple atomically and database ordering makes the last valid write win. Successful agent settlement creates or observes one equivalent active successor without rolling back success on a unique conflict; agent failure/cancellation or direct/automatic exhaustion clears the tuple. Consultations are intentionally not deduplicated and may duplicate read/inference cost, but their restricted capabilities prevent duplicate durable effects.

Agent execution follows the current CRM `AgentRun` boundary. Claim atomically changes an eligible supported row with no session `queued → running` and records `started_at` without incrementing `attempts` or installing an execution lease. The CRM-style `session.started` hook and the post-send path both try to fill the single authoritative `session_id`; the rare case where both miss belongs to the explicitly accepted handoff ambiguity, not an exactly-once claim. Only a `running` row still lacking that id after five minutes may return to `queued`; recovery clears staged completion and `next_*`, while a row with a bound session is never reclaimed. Like the CRM, v1 carries no per-claim handoff generation: after recovery, an exceptionally late callback from the previous delivery can still win a fill-once binding or first-terminal-writer race against the new claim. This narrow failure mode is accepted rather than partially fencing only some update paths. A known delivery rejection, `turn.failed`, `session.failed`, application cancellation, or terminal completion without staged valid `TaskCompletion` ends the task as `failed` or `cancelled`. Unlike the CRM's single `try` around send and binding, failure to persist an already accepted session belongs to the recoverable handoff ambiguity because work may already be executing. Eve follows `turn.cancelled` with `session.waiting`; Branderize treats that waiting as ignored terminal telemetry and never sends another turn to that task address. Canonical database mutations require the task still be `running` in their commit transaction. A swallowed terminal-handler error may leave a bound task running; it alerts for manual stream-based reconciliation, never redispatch. Eve's Workflow resumes process crashes and may replay an interrupted durable step inside the accepted run, so graph writes remain idempotent. Direct work now has two explicit policies: retry-safe deterministic `direct/automatic` handlers may retain bounded leases for transaction-safe internal operations or side-effect-free idempotent external reads, while human-approved external commitments finish deterministic preflight before the atomic `queued → running` point of no return, have no execution lease or reclaim, make at most one provider call, and stop at terminal `outcome_unknown` when the result is ambiguous. On every dispatch, the responsible root classifies its own rows older than `STALE_AFTER`; `PROVIDER_HTTP_TIMEOUT < ROOT_MAX_DURATION < STALE_AFTER` keeps that classifier outside the lifetime of any valid old Function invocation (ADR-018, ADR-019).

If the human promotes a consultation — "save the second recommendation" — that becomes a new typed task. Its payload may carry a size-capped, validated consultation snapshot plus application-verified session/message references; the root treats it as non-canonical input, reloads current graph constraints, and writes through `packages/brain`.

| Agent | Owns | Skills (from marketingskills) |
| --- | --- | --- |
| **cmo** (lead) | Routing, strategy, synthesis | marketing-plan, pricing, offers, marketing-ideas, marketing-council, marketing-loops |
| `product-marketer` | The brand brain: positioning, messaging, competitive set | product-marketing, customer-research, competitor-profiling, marketing-psychology |
| `content` | Long-form: blog, landing pages, case studies, newsletters | copywriting, copy-editing, content-strategy, image, video |
| `distribution` | Short-form social, launches, PR, partnerships | social, launch, public-relations, co-marketing, directory-submissions, influencer-marketing |
| `seo-discovery` | Which pages should exist, audits, schema | seo-audit, ai-seo, site-architecture, programmatic-seo, schema, competitors |
| `lifecycle` | Email, onboarding, activation, retention | emails, onboarding, signup, churn-prevention, popups, paywalls, sms |
| `growth` | Paid, experiments, measurement | ads, ad-creative, ab-testing, analytics, attribution |

Non-overlap rules (the template's lesson): the product-marketer decides *what the team claims*, content writes *the words*, seo-discovery decides *which pages exist*, distribution and lifecycle are the two that *put something in front of an audience*. A newsletter is two hops: content writes the prose, lifecycle adapts it for the inbox and sends it — the lead chains them by passing an artifact id, not by briefing both.

Durable specialist roots may request work from other specialists only across **typed lateral edges** declared in the registry — `(from → to, kind)` triples such as `content → seo-discovery: audit-request` (ADR-013). Consultative subagents may only suggest work to the CMO; they cannot enqueue it. A durable need matching no declared edge returns `blocked` to the CMO hub. Loops die at enqueue dedup; chains are bounded by budget and visible in the graph via `parent_task_id`; authority never travels with the chain — the downstream specialist's own gates apply.

The **brand context** is the only shared state read by everyone at the start of every task, and it has a single owner per brand: the product-marketer. Its quality bounds everything downstream, which is why its structure is a skill rather than a convention, and every claim is graded `proven / plausible / assumption` so downstream agents know when to hedge. It exists in two forms (ADR-008): the full document — an Object in the brain — and a **size-capped preamble extract** that rides in every specialist session, with the cap enforced by the write path rather than by the prompt asking nicely.

### Skills packaging

`packages/marketing-skills` remains a git submodule of Haines' repo plus a materialization step that selects the right subset and **rewrites context-file references** (`.agents/product-marketing.md` → the `get_brand_context` tool reading the projection from the brain). The materialized capabilities are exposed from `packages/agents` through eve workspace-extension entrypoints and mounted by thin local wrappers instead of maintaining copied specialist trees. An extension may contribute skills, tools, connections, instruction fragments, and hooks. It does not carry `agent.ts` configuration or sandbox definitions; schedules and custom channels are root-only and also stay outside the extension. Cross-cutting skills such as writing quality and banned words use the same extension packaging.

### The plan is a derivation, not an artifact (ADR-010)

The marketing plan is compiled, not authored. Durable specialist-root sessions produce structured `evidence` Objects (audits, probes, research) with stable citation keys; the plan is then a **mechanical derivation** — filter candidate moves by active Decisions, prioritize by the strategy Decision, group by funnel stage, version — with no model call. Changing a roadmap-input Decision (budget, goal, timeline) re-derives the plan instantly at zero credits. The CMO routes production of evidence ingredients and proposes Decisions; it does not write plans. The marketing health score is the compiled KPI, and open questions are a projection over low-structure intents — the console renders them as questions whose answers are Decisions that unlock autonomy.

## Policy: effect signatures, not tool lists

Risk is not classified semantically but by a **closed effect signature**: phase (`graph-internal | external-preparation | external-commitment`), class (`reversible-external | irreversible-external | communication | financial` where applicable), scope, and blast radius. The registry assigns it together with the exact renderer, handler, and connector operation; model payloads cannot choose any of them. Graph writes and registered create-only provider drafts are preparation. Schedule, publish, send, activate, spend, merge, pause, unpublish, cancel, and close are commitments.

`packages/policy` is the pure, deterministic function:

```text
(Actor, effect signature, Intent structure level)
  → allowed | requires-verification | requires-human-approval | denied
```

The default verdicts are versioned data, not prompt discipline (ADR-013):

| effect class | low structure | medium | high |
| --- | --- | --- | --- |
| graph-internal | allowed | allowed | allowed |
| external-preparation | allowed | allowed | allowed |
| reversible-external commitment | approval | approval | approval |
| communication commitment | approval | approval | approval |
| irreversible-external commitment | approval | approval | approval |
| financial commitment | approval | approval | approval |

Structure and Policy Decisions may tighten these defaults. They cannot lower the human-approval floor for an external commitment. V1 therefore offers no policy override that turns a publish, send, activation, spend, pause, unpublish, cancellation, or close into an unattended operation. Human roles remain relevant: owner/admin approve everything, members approve non-financial commitments, and viewers approve none.

Capability composition enforces the result before prompts become relevant. Consultative specialists have no write operations. Durable roots may receive an authored, create-only external-draft operation for a registered provider staging primitive, but never a generic mutation or commitment operation. At a commitment boundary, CMO chat and autonomous roots create a direct task in `awaiting_approval` and continue; no eve session parks. The human click appends the final Approval Action and queues that same task. The responsible specialist application then performs the fixed connector call as deterministic code, without an LLM. Its `policy_snapshot` answers “who authorized exactly what?” (ADR-019).

The useful Magister refinement remains structural separation: preparation and commitment are different registered capabilities. A provider draft can be created without granting schedule/publish; a paused campaign can be prepared without granting activation; a PR draft can be prepared without granting merge. Because Eve can replay an interrupted tool step, each external-preparation operation is registered as provider-key idempotent, deterministically recoverable, or explicitly duplicate-safe. Duplicate-safe preparation is at-least-once and may leave harmless private drafts orphaned; if duplication could notify, publish, spend, or otherwise matter, preparation remains internal. The stronger Branderize rule is symmetric: the nominally safe direction (`pause`, `unpublish`, `cancel`, `close`) also requires the same human button. Policy UI may explain or tighten these boundaries, but it cannot enable unattended external commitment. Membership and role are evaluated at that click; the resulting Approval Action remains a durable grant even if the approver is later removed or downgraded. Revocation is an explicit cancellation that must win before claim (ADR-010 as amended by ADR-019).

Sandbox discipline follows eve's trust model (ADR-013): external preparation leaves the building only through a registered create-only operation in the trusted app runtime, and external commitment only through the post-approval deterministic direct handler — never through sandbox commands. Consultative subagents use `deny-all` sandbox egress and reach external reads only through validated read operations. Durable roots may have per-specialist read allow-lists in their own sandbox definitions; credential brokering is reserved for authenticated reads. Domain allow-lists require the Vercel or microsandbox backend — Docker dev runs `deny-all`.

For MCP and OpenAPI connections, eve 0.31.3's `toolCall.providedArguments` may inject trusted `brand_id` or remote-account arguments from verified session context while hiding those keys from the model-facing schema. This is parameter control, not tenancy or credential ownership: eve connection principals are only `app` or `user`, not `brand`. A Better Auth user principal can authenticate the current caller but never becomes the durable owner of a provider grant. `apps/app` owns connection onboarding and membership checks; the claimed task or authenticated CMO turn carries a verified `brand_id`; an application credential provider resolves that brand's active `brand_connections` row through `auth(ctx)`, headers, or an authored tool. Tokens never enter task payloads, model-visible arguments, or session history. If Vercel Connect is used, its installation/reference is implementation behind that brand row rather than the domain owner. Eve extensions can distribute this adapter to all roots, but brand ACLs, connection storage, rotation, and selection remain application responsibilities.

## Channels and surfaces

The web console (`apps/app`) is the primary surface (ADR-003) and it is **a view over the graph, not the foundation of the system**:

1. **Approval inbox** — the main surface: direct tasks in `awaiting_approval`. Each registered kind supplies its typed payload, preview renderer, effect derivation, responsible worker, fixed connector operation, and concurrency policy. Edit and approval use symmetric status-plus-revision compare-and-swap transactions: edit records the human delta and increments the revision only while still awaiting approval; the click authorizes only the exact final revision and makes every stale edit fail. The click authorizes the current registered provider operation and persists that authority: v1 neither pins the external account, blocks execution on provider-side drift, nor revokes an Approval Action because its actor later loses membership. A currently authorized human must explicitly cancel before claim. Batch selection is only UI over per-task transactions and results. If a serialized non-commutative commitment already owns the same target in `queued | running`, a conflicting click rolls back and returns `target_busy`; it is not silently queued (ADR-011, ADR-019)
2. **Open questions** — what awaits information: a projection over low-structure intents; every answer is a Decision that unlocks autonomy (ADR-010)
3. **Digest with citations** — a narrative of what happened on your intents: a mechanical skeleton (actions, pending items, due rechecks) plus CMO narrative whose citations are validated against the graph — the renderer rejects references to objects that do not exist (ADR-011)
4. **Graph browser** — backward traversal: from any object to the Intents and Decisions that justify it
5. **Chat** — only natural-language intent entry (transduction), never a place of truth. A brand may have many CMO conversations, each selected and authorized through its application-owned `conversation_id`. Only the CMO uses eve 0.31.3's default `/eve/v1/session*` UI surface. Session creation returns one immutable `session_id`; the adapter persists that id and the latest `stream_index` after consuming events. It stores no public continuation token or opaque session-state JSON. The console renders permanent `chat_messages` for the selected conversation. A waiting session can continue through the same fixed id; a terminal or unavailable conversation remains readable and the next thread is a new application conversation, matching the CRM (ADR-014, ADR-016)

A carved-in-stone rule (from the CRM): **no intelligence in the console routes** — and it is enforced physically by seven standalone root deployments. `apps/app` reaches only `agent-cmo` through an authenticated same-origin `/eve/v1/*` proxy that mints short-lived user-principal tokens with `CMO_BRIDGE_SECRET`; only those two deployments hold that HS256 credential. The CMO's authored `eveChannel` verifies that human bridge identity and is the only default eve session surface exposed to the product UI. The six specialist roots are machine-only and receive only the raw-Bearer `DISPATCH_SECRET` needed to wake the custom-channel `POST /internal/dispatch`, so they cannot mint user tokens (ADR-009). Their separately authored `eveChannel({ auth: [localDev()] })` routes reject info and session callers in production while health stays public; the dispatch custom channel authenticates its own route and starts task mode only after a claim through `from(taskAddress).send(...)`. Framework-owned callback routes remain available only to resume already accepted durable work; they cannot start unrelated work. The design uses no private `disableRoute()` seam. Console routes read projections and write only intents, approvals, and explicit pre-claim cancellations through `packages/brain`; Biome restricted imports make the line mechanical inside the app as well. The anti-metric is explicit: human time in the console must trend down at constant work output. A console that creates engagement is failing.

Data-surface discipline (ADR-009): `brand_id` is an explicit first parameter of every brain function, resolved once from the URL — never ambient. RSC read projections; Server Actions write through the brain with zod at the boundary; filtering and sorting stay in SQL behind column allow-lists. Freshness: agent writes are background writes — the console polls while work is in flight and stops when settled (lists too, not just detail views), while user mutations invalidate through one cache module. Every optional capability shows a counter of the work waiting on it.

## Data flow: the onboarding loop

The product wedge — the first full turn of the flywheel:

```text
self-serve signup → org + brand with website_url
  → Intent: "build the brand brain"
    → product-marketer: context.dev Brand API for the brand kit (logo, colors,
      fonts, styleguide, socials) + site crawl to markdown (ADR-012);
      the user interview covers what the web cannot tell (goals, taste, constraints);
      brand context v0 with graded claims
    → cmo: proposes the first roadmap-input Decisions; the first-week plan
      compiles mechanically from evidence + Decisions (ADR-010)
  → commitment tasks land in the approval inbox
    → the human approves / edits
  → the first Decisions enter the graph: the loop is closed
```

## Schedules and the feedback loop

Durable roots book their own follow-ups through an authored, typed `scheduleRecheck` tool: the agent judges when and why to return, while deterministic application code validates the typed payload and resolves the sole authorized recheck kind from the current task's registry entry. The model never supplies a target `kind`, `task_id`, `brand_id`, `subject_key`, or `worker_key`; the tool obtains current-task identity from trusted eve session context and derives the rest from the task row and registry. The initial future recheck has a distinct kind from its immediate source task, so it is inserted or an equivalent existing booking is moved normally. When a running recheck schedules the same kind and subject again, the tool leaves that row's `due_at` untouched and saves one pending successor in `next_due_at`, `next_payload`, and `next_rationale` with `UPDATE ... WHERE id = current_task_id AND status = 'running' RETURNING`. A zero-row result is `task_closed`; the tool neither inserts nor reschedules as fallback. Terminal settlement updates the same row, so Postgres orders the race without a general source-task lock. Concurrent valid schedulers atomically replace the one scheduled booking or staged tuple; the last valid database write wins, with no priority or merge. For an agent task, only `session.completed` with a `finishTask`-staged valid `TaskCompletion` changes the current row to `succeeded`; in the same transaction, it attempts successor creation with a stable key derived from the source task and observes an equivalent active booking if that row won concurrently. Agent failure/cancellation and direct/automatic exhaustion clear staged scheduling and create no successor. Human external commitments never carry `next_*`. Consultative subagents can only recommend a follow-up to the CMO. An agent that cannot say why it will be back in fourteen days does not have a reason, it has a default. Every cadence lives in task scheduling data because per-brand cadences are data, not code.

There are **no eve schedules**. One Vercel Cron invokes `apps/app`, which authenticates the ingress with `CRON_SECRET`; that credential is never forwarded. The route uses `DISPATCH_SECRET` to fan out seven parallel calls to each root's custom-channel `POST /internal/dispatch` route with independent two-second timeouts. Each call is a payload-free poke: it accepts no task, brand, worker, or target selector, and the called root applies `worker_key = SELF AND kind IN compiledSupportedKinds`. `Promise.allSettled` waits only for each root's `202`; each custom-channel handler continues its drain with `waitUntil` and uses `from(taskAddress).send(...)` only after an agent-row claim. For the six specialist deployments this is the only production ingress that can create work; their default eve session API is local-development-only. A process-local collapsing guard reduces duplicate drains within one warm instance, while atomic agent claims, bounded direct/automatic leases, and one-shot human-commitment claims provide cross-instance correctness. Duplicate or overlapping cron invocations are safe and one unavailable root does not block the others. Each healthy root first applies a separately bounded stale-human scan, then scans a bounded candidate set until its per-invocation batch has enough successful claims: approved commitments by `execute_before NULLS LAST, approved_at, id`; remaining slots to due retry-safe direct/automatic work by `created_at, id`; then due agent work by `created_at, id`. Non-claiming diagnostics consume no slot. This is admission preference with no generic priority, preemption, global semaphore, or cross-instance completion order. Sustained higher-lane load may starve lower lanes in v1 (ADR-009, ADR-011, ADR-018, ADR-019).

Queue mechanics (ADR-007, ADR-009, ADR-014, ADR-017, ADR-018, ADR-019): active-work identity uses `(kind, brand_id, subject_key) WHERE status IN ('awaiting_approval', 'queued', 'running')`; a unique creator/occurrence key protects exact replay of the request that created a row, while v1 deliberately stores no aliases for later coalesced requests. Human commitment tasks use a per-proposal subject identity rather than semantic target/payload dedup. Registered non-commutative kinds additionally derive a trusted conflict key shared by inverse commands on the same stateful target; a separate partial unique index rejects the second approval while the first is `queued | running`, without collapsing either proposal or creating a FIFO. Every registered kind supplies `worker_key`, `execution_mode: agent | direct`, activation policy, and execution semantics; each root supplies `compiledSupportedKinds`. Agent mode first applies the autonomous-credit gate, then atomically claims `queued → running`, reloads task and graph context, and attempts delivery with `mode: "task"`; at zero balance it stays queued and opens no session. `session.started` normally binds the id immediately. It does not increment `attempts` or create an execution lease. Only a stale sessionless handoff may return to `queued`; after authoritative `session_id` binding, failure is terminal and an explicit retry is a new task. `finishTask` stages the canonical completion, then `session.completed` normally settles `succeeded`; `completed`, `partial`, and `blocked` are domain outcomes beneath it. Retry-safe direct/automatic kinds may retain bounded retry for local transactional operations or side-effect-free idempotent provider reads; neither direct lane reads the agent credit gate, and the automatic lane never writes externally. A human external-commitment kind begins at `awaiting_approval`; only `approveTask` appends the Approval Action and queues it. Its owning root then atomically claims it even at zero pool balance and makes at most one deterministic provider call. The provider-specific connector returns only `accepted(receipt) | rejected(code, message) | unknown(code, message)`; the generic dispatcher exhaustively maps those results to `succeeded | failed | outcome_unknown` and treats any unexpected post-claim throw as unknown. Only a schema-valid stable receipt can succeed, and only provider-contract proof of non-application can fail; none of these states is lease-reclaimed. A later try is a new human-approved task. Conflicting async kinds are enabled only when acceptance is effect-final, provider-linearized, or protected by conditional/versioned state. Autonomous agent sessions and interactive CMO chat therefore share one proposal mechanism and never park an eve tool to execute an external commitment.

For a claimed human commitment, local terminal settlement is indivisible: the discriminated Execution/Result Action, `result_action_id`, task error projection, `finished_at`, and the compare-and-swap from `running` to `succeeded`, `failed`, or `outcome_unknown` commit in one Postgres transaction. A billable `succeeded` also inserts exactly one `action_charge` there, using the cost and pricing version frozen at approval; every other outcome inserts none. A lost compare-and-swap rolls back the Action and charge. The stale classifier uses the same `unknown(code, message)` result shape. The external HTTP call remains outside that transaction, so a crash after claim—even before HTTP—or after provider acceptance but before local settlement remains the deliberately conservative, uncharged unknown-outcome case. There is no pre-call marker, `running → queued` recovery, or retroactive charge from later Verification; avoiding that false unknown case would require fenced claim generations, which v1 does not add (ADR-019).

When a commitment kind promises eventual-outcome tracking, that same acceptance transaction also creates or observes its first same-root `direct/automatic` provider-outcome Verification poll from the stable receipt. The existing Next.js cron and root dispatcher later execute a side-effect-free idempotent provider read in plain TypeScript; no eve session, model generation, or agent credit is involved. A valid `pending`, `completed`, provider-domain `failed`, or provider-domain `unverified` observation appends a Verification Action linked to both the originating Result Action and poll task and technically succeeds that poll; only `pending` atomically schedules one stable-key successor after settling the current occurrence. Deadline is checked before runtime capability and records `unverified(deadline_reached)`; bounded technical exhaustion fails the poll task and records `unverified(technical_exhaustion)`. Neither form is the analytics Decision-impact Verification described below. Providers without durable lookup remain acceptance-only. V1 exposes no provider webhook routes and stores no generic provider-event inbox; this follows the current CRM's polling-first sync precedent (ADR-019).

The analytics feedback loop is a Verification: measured metrics are compared against what the authorizing Decision claimed, and the outcome re-enters the graph as a judgment. The loop closes into work, not just data (ADR-011): every measurable Decision declares its verification plan at creation (metric, baseline, horizon — a Decision without one is a low-structure object and surfaces in open questions), and a negative judgment marks the Decision contested and enqueues a CMO task to propose a motivated supersession. This is the compounding byproduct: the judgment dataset.

## Credits

The Magister model: a monthly credit pool per plan, consumption metered at the AI Gateway and by action type, overage at a unit price. The `credit_ledger` is append-only: even billing speaks the grammar.

Three nested budgets (ADR-011): the plan cap (hard, billing) contains the brand's monthly pool (from the subscription), which contains each session's budget (set by the policy at dispatch — autonomous runs get less). The dispatcher checks the brand pool only before claiming `execution_mode = agent`; at zero, those tasks stay queued and the console shows the work waiting on credits. The gate is deliberately absent from both deterministic direct lanes. In particular, an approved `direct/human` commitment executes at zero pool balance. Only billable `succeeded` with a stable receipt records exactly one `action_charge` and may drive the balance into paid overage; every unsuccessful or ambiguous outcome is uncharged. Running out mid-agent-session is a deliberate `partial` completion: the specialist saves the partial work as an Object, stages `TaskCompletion`, and exits successfully.

## Integrity metrics (CI)

Part V of the ADE document becomes automated tests — the system's type-check:

- **Provenance completeness = 100%**: every Object has a valid producing Action
- **Policy replay**: re-evaluating the persisted `policy_snapshot`s yields the same outcomes
- **Projection rebuildability**: every materialized view can be rebuilt from the Action log
- **Effect-signature coverage**: every boundary Action has an assigned class

## Roadmap

- **Phase 0 — Product foundations**: `packages/db` + `packages/brain` + `packages/policy`; auth (Better Auth, Google) with orgs/brands; `agent-cmo` plus the six standalone specialist root apps, shared registry materialization, CMO-only console proxy, and the Next.js cron fan-out; CMO + product-marketer capabilities; onboarding loop v0; console v0 = intent entry + object browser
- **Phase 1 — The team that delivers**: + content, distribution, seo-discovery; Notion/Typefully connections with effect-signature allowlists; approval inbox; artifact handoff by id
- **Phase 2 — The habitable graph**: supersession UI for Decisions, digest with citations, live tasks queue, first schedule (daily brief), the compiled plan surface with Rebuild + open questions
- **Phase 3 — Feedback loop**: lifecycle + Resend; analytics connection; Verification objects; credits and billing
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
