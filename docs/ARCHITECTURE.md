# ARCHITECTURE.md

This document maps how branderize-cmo is put together, for humans and AI agents working in the repo. Keep it current as the codebase evolves: every structural change ships with a new ADR or with the supersession of an existing one.

## Project identification

- **Name:** `branderize-cmo`
- **Maintainer:** Tommaso
- **License:** TBD
- **Last updated:** 2026-08-05

## Overview

branderize-cmo is an **agent-native marketing team**: a team of agents — a CMO lead and seven specialists — built on the [eve](https://eve.dev) framework, working on a *work graph* shared with humans instead of scattered communication across human-native apps. The center of the system is not the chat: it is the operational state of the work, with full provenance.

The project fuses five sources, each with a distinct role:

| Source | Role in the design |
| --- | --- |
| ADE agent-native document (v15, internal) | The ontology: Actor, Intent, Object, Action, Policy; work graph; provenance; proportional gate; effect signatures; the anti-metric |
| [eve](https://eve.dev) | The runtime: durability, sessions, sandboxes, channels, subagents, schedules, human-in-the-loop |
| [marketing-team-eve-template](https://github.com/vercel-labs/marketing-team-eve-template) | The tactical skeleton: lead + specialists, self-contained briefs, approval gates, MCP allowlists, artifact handoff by id |
| [trycompai/crm](https://github.com/trycompai/crm) | The operational discipline: no intelligence in the API, leased work queue, the agent booking its own follow-ups |
| [Magister](https://magistermarketing.com/) + [marketingskills](https://github.com/coreyhaines31/marketingskills) | The product horizon (multi-tenant SaaS, credits, self-serve onboarding) and the capability content (~44 marketing skills) |

The differentiator versus Magister is not the feature surface: it is the grammar. Every output has provenance, every decision is a normative object with supersession, every boundary action passes through a deterministic Policy. The system accumulates the judgment dataset by construction.

## Founding decisions

Architectural decisions are versioned normative objects in `adrs/` — the software ADR pattern generalized to all work, as the ADE document prescribes (§9). Nothing is deleted: it is superseded.

- [ADR-001 — Multi-tenant SaaS product](../adrs/001-multi-tenant-saas.md)
- [ADR-002 — Postgres as the work graph substrate](../adrs/002-postgres-work-graph.md)
- [ADR-003 — Web console as the primary surface, eve mounted in apps/app](../adrs/003-web-console-eve-in-app.md)
- [ADR-004 — Extended roster of seven specialists](../adrs/004-extended-roster.md)
- [ADR-005 — Drizzle + Neon for data access, Better Auth for authentication](../adrs/005-drizzle-neon-better-auth.md)
- [ADR-006 — Dual declaration: subagents + named root agents from a shared registry](../adrs/006-dual-declaration.md)
- [ADR-007 — Approvals and the tasks queue: park on interactive, deny-and-propose on autonomous](../adrs/007-approvals-and-tasks-queue.md)
- [ADR-008 — Brain write-path rules, tool design, and model resolution](../adrs/008-brain-write-path-and-model-resolution.md)
- [ADR-009 — The agent as its own deployment, and the console's data-surface discipline](../adrs/009-agent-deployment-and-console-data-surface.md)
- [ADR-010 — The plan is a derivation, and other lessons from the Magister product](../adrs/010-plan-as-derivation.md)
- [ADR-011 — Self-grilling: delegation guards, the CMO's job list, closing the verification loop, budget hierarchy, proposal shape, one schedule, human roles](../adrs/011-self-grilling-closing-the-gaps.md)
- [ADR-012 — Contracts: one approval source, the brief schema, the intent lifecycle, plan-compiler inputs](../adrs/012-contracts-approval-brief-intents-compiler.md)
- [ADR-013 — The policy matrix, typed lateral edges, and sandbox rules on eve's real trust model](../adrs/013-policy-matrix-lateral-edges-sandbox.md)

## From the ADE grammar to eve primitives

| ADE primitive | Incarnation in branderize-cmo |
| --- | --- |
| **Actor** | A row in `actors` (`type: human \| agent`). eve agents (lead + specialists) are first-class actors: identity, scope, capabilities, audit |
| **Intent** | A row in `intents`. Born valid with the minimal core (author + statement); structure (acceptance criteria, constraints) is delegable work that unlocks autonomy, not an upfront toll |
| **Object** | A row in `objects` with `produced_by → actions.id` NOT NULL and `superseded_by → objects.id`. Brand context, decisions, artifacts, reports |
| **Action** | A row in `actions` (append-only): tool call, MCP call, schedule run, human approval — always with author, timestamp, rationale, and `policy_snapshot` |
| **Policy** | A pure function in `packages/policy`: (Actor, effect signature, Intent structure level) → allowed / requires-verification / requires-human-approval / denied |
| **State** | A projection (materialized view) over the Action log. Never an independent object, never diverging from the Trace |
| **Verification** | A typed Action producing a judgment. The analytics feedback loop closes Decision → measurement → judgment |
| **Context** | A query over `objects` given an Intent — not a file to pass around |

## Monorepo layout

Turborepo + pnpm. Current state: `apps/web` and `apps/app` are Next.js 16 boilerplate, `packages/ui` holds the shadcn components, Ultracite/Biome tooling.

Target:

```text
branderize-cmo/
  apps/
    web/                  # branderize public site — the team's first client is branderize itself (dogfooding)
    app/                  # console: RSC + Server Actions over packages/brain; authenticated /eve/v1/* proxy (ADR-009)
    agent/                # the eve deployment: CMO + specialists, schedules, channels, dispatcher (ADR-003, ADR-009)
      agent/              # the eve directory: instructions.md, subagents/, skills/, tools/, channels/, schedules/
  packages/
    ui/                   # shadcn/ui — the only source of UI
    db/                   # Drizzle schema, migrations, shared Neon Postgres client (ADR-005)
    brain/                # the ONLY write path of the work graph + projection reads (rules: ADR-008)
    policy/               # effect signatures → approval matrix as a pure function
    agents/               # shared specialist registry: definitions, actor keys, task kinds, model defaults + resolver (ADR-006, ADR-008)
    marketing-skills/     # submodule of coreyhaines31/marketingskills + materialization script
    env/                  # shared root .env loading
    typescript-config/
```

## The work graph: schema and invariants

Postgres is the only canonical store (ADR-002). Two layers:

**Product layer** — `organizations`, `users`, `brands` (org → many brands, the Magister model). Every row in the grammar layer is scoped by `brand_id`.

**Grammar layer** — the work graph:

| Table | Contents |
| --- | --- |
| `actors` | Humans and agents in the same table: `type`, handle, capabilities |
| `intents` | Statement, author, `structure_level`, status, `parent_intent_id` |
| `objects` | `type` (brand_context, decision, evidence, artifact, proposal, report…), content, `produced_by`, `superseded_by`, lifecycle `status` (active / proposed / superseded / dismissed — ADR-008) |
| `actions` | Append-only: `actor_id`, `type`, `rationale`, `intent_id`, `effect_class`, `policy_snapshot` |
| `tasks` | Work queue: `kind`, `payload`, `due_at`, `leased_until`, `lease_owner` — leased with `FOR UPDATE SKIP LOCKED` |
| `credit_ledger` | Append-only: credit consumption and grants per brand |

Three invariants pay the provenance debt (Git would give these properties for free; here they are discipline):

1. **`objects.produced_by` is NOT NULL.** Every Object is born from an Action. Provenance completeness = 100%: any deviation is a bug, not an opinion.
2. **`actions` is append-only; Objects are never mutated, they are superseded.** A Decision is an Object with `type='decision'` and status active/superseded; supersession is a new Object pointing at the previous one. History is never rewritten; revocation is always ex nunc.
3. **A single write path.** `packages/brain` exposes typed functions (`declareIntent`, `produceObject`, `recordDecision`, `scheduleRecheck`, …) that, in one transaction, evaluate the Policy, persist the `policy_snapshot`, and write Action + Object. The agents' eve tools and the console routes all go through it. No direct writes anywhere else.

Current state (e.g. a brand's active brand context) is a **projection**: a materialized view over the latest non-superseded Object of that type. Pending approvals are Actions with status `pending`: the console's approval inbox is a query, not a feature of its own. Binary artifacts (images, video, PDFs) live in content-addressed blob storage — the key carries the byte hash, so re-runs are idempotent; the Object holds metadata plus the blob key, and the console renders via short-lived signed URLs (ADR-011).

## The agent team

One lead — the **CMO** — and seven specialists (ADR-004). The lead loads the brand context and preferences, structures the incoming intent, writes a self-contained brief for exactly one specialist, and hands back the work without rewriting it. Every specialist call is a fresh session that inherits nothing: the brief carries everything. Delegation is one level deep: specialists do their own research and their own review pass, they do not spawn further agents.

The CMO's job list is explicit (ADR-011): transduction of human chat into structured intents, routing with self-contained briefs, synthesis of specialist outputs back to the human, proposing roadmap-input Decisions, and the daily brief narrative. It does not author plans (ADR-010) and owns no special schedule — the daily brief is a task kind dispatched to the CMO root agent like any other.

The brief is a zod schema per task kind, not a phrase (ADR-012): it carries the intent id, the size-capped brand-context preamble, artifact references **by id**, the constraints from active Decisions, the capabilities snapshot, the session budget, and an `output_contract` declaring which Object types the session may produce — the write path rejects the rest. What comes back is a token-capped summary plus produced object ids, follow-up tasks, and open questions: never full artifact bodies.

### Two activation paths (ADR-006)

Every specialist is declared twice from one shared definition in `packages/agents/registry.ts`:

- **Interactive path** — as a declared subagent of the CMO: in-process delegation, native control-plane events, proxied approval prompts. Humans only ever talk to the CMO; specialist routes are machine-only (dispatcher principal `eve:app`).
- **Deterministic path** — as a named root agent in the same agent deployment (multi-agent mount, `/eve/agents/<name>` prefix): own schedules, activatable by the tasks-queue dispatcher with typed payloads validated at enqueue time.

Actor identity is a build-time constant of the definition (`actorKey`), not a runtime session property: both declarations write the same `actions.actor_id`, while `intents.author_actor_id` records who authorized the work (the human, or the originating Decision). Autonomous credit spend is capped by a global per-plan Policy; Decisions may only restrict it further.

Both doors dedup (ADR-011): the CMO's delegation tool checks the tasks table for in-flight work on `(specialist, brand_id)` before delegating — if a run is hot, it waits and reuses the output, or enqueues an interactive-priority task, instead of paying for a second overlapping session.

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

Specialists may request work from other specialists only across **typed lateral edges** declared in the registry — `(from → to, kind)` triples such as `content → seo-discovery: audit-request` (ADR-013). A need matching no declared edge returns `blocked` to the CMO hub. Loops die at enqueue dedup; chains are bounded by budget and visible in the graph via `parent_task_id`; authority never travels with the chain — the downstream specialist's own gates apply.

The **brand context** is the only shared state read by everyone at the start of every task, and it has a single owner per brand: the product-marketer. Its quality bounds everything downstream, which is why its structure is a skill rather than a convention, and every claim is graded `proven / plausible / assumption` so downstream agents know when to hedge. It exists in two forms (ADR-008): the full document — an Object in the brain — and a **size-capped preamble extract** that rides in every specialist session, with the cap enforced by the write path rather than by the prompt asking nicely.

### Skills packaging

eve has no shared-skill mechanism: `packages/marketing-skills` is a git submodule of Haines' repo plus a materialization script that copies the right subset into each subagent's `skills/` directory and **rewrites context-file references** (`.agents/product-marketing.md` → the `get_brand_context` tool reading the projection from the brain). Cross-cutting skills (writing-quality, banned words) follow the template's `defineSkill` factory pattern.

### The plan is a derivation, not an artifact (ADR-010)

The marketing plan is compiled, not authored. Specialist sessions produce structured `evidence` Objects (audits, probes, research) with stable citation keys; the plan is then a **mechanical derivation** — filter candidate moves by active Decisions, prioritize by the strategy Decision, group by funnel stage, version — with no model call. Changing a roadmap-input Decision (budget, goal, timeline) re-derives the plan instantly at zero credits. The CMO produces evidence ingredients and proposes Decisions; it does not write plans. The marketing health score is the compiled KPI, and open questions are a projection over low-structure intents — the console renders them as questions whose answers are Decisions that unlock autonomy.

## Policy: effect signatures, not tool lists

Risk is not classified semantically but by **effect signature**, from a closed vocabulary: `reversible-external`, `irreversible-external`, `communication`, `financial` — with scope and blast radius. Actions that only mutate the work graph are reversible by construction and always allowed as proposals; boundary actions (the MCP connectors) carry the class assigned at connector registration.

`packages/policy` is the pure, deterministic function:

```text
(Actor, effect signature, Intent structure level)
  → allowed | requires-verification | requires-human-approval | denied
```

The default verdicts are versioned data, not prompt discipline (ADR-013):

| effect class | low structure | medium | high |
| --- | --- | --- | --- |
| graph-internal | allowed | allowed | allowed |
| reversible-external | approval | verification | allowed |
| communication | approval | approval | verification |
| irreversible-external | approval | approval | approval |
| financial | approval | approval | approval |

Structure moves a verdict at most one step per column; `irreversible-external` and `financial` have an absolute floor at approval; `communication` never reaches `allowed` by structure alone — full automation there always takes an explicit Decision. Policy-override Decisions (the per-category toggles) set a cell explicitly, never below the floors.

eve connections enforce the result: per-connection tool allowlists (the precedent is Resend cut from ~85 to 47 tools in the template) and approval gates where the function prescribes them. Approval semantics are principal-aware (ADR-007, from the trycompai/crm precedent): interactive sessions park at the gate, while automated sessions are denied with an instruction and leave a ready-to-execute proposal Object instead. The `policy_snapshot` persisted on every Action turns "why are you asking me to approve this?" into a query with a mechanical answer. Determinism covers the gate, not the judgment inside the gate: the outcome of a verification still belongs to the actors. Human roles are part of the Actor the function reads (ADR-011): owner/admin approve everything, members approve the non-financial, viewers are read-only — overridable per org via a Decision.

Two refinements from the Magister product (ADR-010): the console renders the policy as per-category ask/auto switches whose toggles write `policy-override` Decisions — the UI stays trivial, the state stays versioned. And connectors make the dangerous thing **structurally impossible** rather than merely gated: draft and publish are separate tools, ad campaigns are created paused (activation is the explicit money step), PRs never target the default branch, and the safe direction (pause, unpublish, close) is always allowed without a gate.

Sandbox discipline follows eve's trust model (ADR-013): writes leave the building only as authored tool or connection calls in the app runtime — never as sandbox commands, where there is no gate, no `policy_snapshot`, no provenance. Sandboxes default to `deny-all` egress with per-specialist read allow-lists in each specialist's own `sandbox/` definition (eve gives every subagent its own sandbox); credential brokering is reserved for authenticated reads. Domain allow-lists require the Vercel or microsandbox backend — Docker dev runs `deny-all`.

## Channels and surfaces

The web console (`apps/app`) is the primary surface (ADR-003) and it is **a view over the graph, not the foundation of the system**:

1. **Approval inbox** — the main surface: what awaits human judgment. Proposals carry `{ render_hint, payload, base_state_ref }` and each type has a console renderer (email preview, social card, diff against current state). Edit-before-approve is supported with dual provenance — the agent's draft and the human's delta are separate Actions, and the edited payload is what executes. `execute-proposal` re-reads external state when the connector allows and reopens the proposal on drift instead of executing a stale payload (ADR-011)
2. **Open questions** — what awaits information: a projection over low-structure intents; every answer is a Decision that unlocks autonomy (ADR-010)
3. **Digest with citations** — a narrative of what happened on your intents: a mechanical skeleton (actions, pending items, due rechecks) plus CMO narrative whose citations are validated against the graph — the renderer rejects references to objects that do not exist (ADR-011)
4. **Graph browser** — backward traversal: from any object to the Intents and Decisions that justify it
5. **Chat** — only natural-language intent entry (transduction), never a place of truth

A carved-in-stone rule (from the CRM): **no intelligence in the console routes** — and it is enforced physically: the agent is its own deployment (`apps/agent`), reachable only through an authenticated same-origin proxy that mints short-lived user-principal tokens (ADR-009). Console routes read projections and write only intents and approvals through `packages/brain`; Biome restricted imports make the line mechanical inside the app as well. The anti-metric is explicit: human time in the console must trend down at constant work output. A console that creates engagement is failing.

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
  → proposals land in the approval inbox
    → the human approves / edits
  → the first Decisions enter the graph: the loop is closed
```

## Schedules and the feedback loop

The agent books its own follow-ups: `scheduleRecheck` writes a row in `tasks` with `due_at` and a **rationale shown to the human** — an agent that cannot say why it will be back in fourteen days does not have a reason, it has a default. There is exactly one eve schedule — the dispatcher tick — and it decides nothing (ADR-011): every cadence (the daily brief at 9 in the brand's timezone, the weekly SEO audit) lives in `tasks.due_at` rows, because per-brand cadences are data, not code. Two dispatchers take disjoint work thanks to the lease.

Queue mechanics (ADR-007, after the CRM): dedup at enqueue per `(kind, brand_id, subject)`; bounded leases with `FOR UPDATE SKIP LOCKED`; max attempts with retirement; retries resume the prior thread instead of restarting. Two lanes: agent tasks (the dispatcher starts a specialist session) and `execute-proposal` tasks (deterministic code, no LLM, running exactly the approved boundary call). Autonomous runs never park: boundary actions are denied with an instruction, and the work product up to the gate is saved as a proposal Object awaiting human settlement.

The analytics feedback loop is a Verification: measured metrics are compared against what the authorizing Decision claimed, and the outcome re-enters the graph as a judgment. The loop closes into work, not just data (ADR-011): every measurable Decision declares its verification plan at creation (metric, baseline, horizon — a Decision without one is a low-structure object and surfaces in open questions), and a negative judgment marks the Decision contested and enqueues a CMO task to propose a motivated supersession. This is the compounding byproduct: the judgment dataset.

## Credits

The Magister model: a monthly credit pool per plan, consumption metered at the AI Gateway and by action type, overage at a unit price. The `credit_ledger` is append-only: even billing speaks the grammar.

Three nested budgets (ADR-011): the plan cap (hard, billing) contains the brand's monthly pool (from the subscription), which contains each session's budget (set by the policy at dispatch — autonomous runs get less). The dispatcher checks the brand pool before leasing agent tasks; at zero, tasks stay queued and the console shows the work waiting on credits — credits are a capability like any other. Running out mid-session is a normal ending: the specialist saves the partial work as an Object and exits.

## Integrity metrics (CI)

Part V of the ADE document becomes automated tests — the system's type-check:

- **Provenance completeness = 100%**: every Object has a valid producing Action
- **Policy replay**: re-evaluating the persisted `policy_snapshot`s yields the same outcomes
- **Projection rebuildability**: every materialized view can be rebuilt from the Action log
- **Effect-signature coverage**: every boundary Action has an assigned class

## Roadmap

- **Phase 0 — Product foundations**: `packages/db` + `packages/brain` + `packages/policy`; auth (Better Auth, Google) with orgs/brands; eve as its own deployment (`apps/agent`) behind the console proxy; CMO + product-marketer; onboarding loop v0; console v0 = intent entry + object browser
- **Phase 1 — The team that delivers**: + content, distribution, seo-discovery; Notion/Typefully connections with effect-signature allowlists; approval inbox; artifact handoff by id
- **Phase 2 — The habitable graph**: supersession UI for Decisions, digest with citations, live tasks queue, first schedule (daily brief), the compiled plan surface with Rebuild + open questions
- **Phase 3 — Feedback loop**: lifecycle + Resend; analytics connection; Verification objects; credits and billing
- **Phase 4 — Scale**: growth as a remote agent with its own ads credentials; MCP server channel (read by default, scoped writes, approval polling) + agent-native signup; public self-serve launch. Per-brand dedicated agent deployments stay possible via the `brand → agent endpoint` lookup (ADR-010)

## References

| Link | Covers |
| --- | --- |
| [eve documentation](https://eve.dev/docs/introduction) | The framework: agents, subagents, skills, channels, schedules, HITL |
| [marketing-team-eve-template](https://github.com/vercel-labs/marketing-team-eve-template) | The tactical precedent: `agent/` layout, approval matrix, credential model |
| [trycompai/crm](https://github.com/trycompai/crm) | The operational precedent: work queue, deny-all sandbox, autonomous agent |
| [marketingskills](https://github.com/coreyhaines31/marketingskills) | The marketing capability taxonomy |
| [Magister](https://magistermarketing.com/) | The product benchmark |
| [Drizzle ORM](https://orm.drizzle.team/) | Schema, queries, migrations (ADR-005) |
| [Neon](https://neon.tech/) | Serverless Postgres (ADR-005) |
| [Better Auth](https://better-auth.com) | Authentication, with the Drizzle adapter (ADR-001, ADR-005) |
