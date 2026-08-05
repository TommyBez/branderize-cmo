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
    app/                  # console + eve agent mounted via withEve (ADR-003)
      agent/              # the eve directory: instructions.md, subagents/, skills/, tools/, channels/, schedules/
  packages/
    ui/                   # shadcn/ui — the only source of UI
    db/                   # Prisma schema, migrations, shared Postgres client
    brain/                # the ONLY write path of the work graph + projection reads
    policy/               # effect signatures → approval matrix as a pure function
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
| `objects` | `type` (brand_context, decision, artifact, report…), content, `produced_by`, `superseded_by` |
| `actions` | Append-only: `actor_id`, `type`, `rationale`, `intent_id`, `effect_class`, `policy_snapshot` |
| `tasks` | Work queue: `kind`, `payload`, `due_at`, `leased_until`, `lease_owner` — leased with `FOR UPDATE SKIP LOCKED` |
| `credit_ledger` | Append-only: credit consumption and grants per brand |

Three invariants pay the provenance debt (Git would give these properties for free; here they are discipline):

1. **`objects.produced_by` is NOT NULL.** Every Object is born from an Action. Provenance completeness = 100%: any deviation is a bug, not an opinion.
2. **`actions` is append-only; Objects are never mutated, they are superseded.** A Decision is an Object with `type='decision'` and status active/superseded; supersession is a new Object pointing at the previous one. History is never rewritten; revocation is always ex nunc.
3. **A single write path.** `packages/brain` exposes typed functions (`declareIntent`, `produceObject`, `recordDecision`, `scheduleRecheck`, …) that, in one transaction, evaluate the Policy, persist the `policy_snapshot`, and write Action + Object. The agents' eve tools and the console routes all go through it. No direct writes anywhere else.

Current state (e.g. a brand's active brand context) is a **projection**: a materialized view over the latest non-superseded Object of that type. Pending approvals are Actions with status `pending`: the console's approval inbox is a query, not a feature of its own.

## The agent team

One lead — the **CMO** — and seven specialists (ADR-004). The lead loads the brand context and preferences, structures the incoming intent, writes a self-contained brief for exactly one specialist, and hands back the work without rewriting it. Every specialist call is a fresh session that inherits nothing: the brief carries everything. Delegation is one level deep: specialists do their own research and their own review pass, they do not spawn further agents.

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

The **brand context** is the only shared state read by everyone at the start of every task, and it has a single owner per brand: the product-marketer. Its quality bounds everything downstream, which is why its structure is a skill rather than a convention, and every claim is graded `proven / plausible / assumption` so downstream agents know when to hedge.

### Skills packaging

eve has no shared-skill mechanism: `packages/marketing-skills` is a git submodule of Haines' repo plus a materialization script that copies the right subset into each subagent's `skills/` directory and **rewrites context-file references** (`.agents/product-marketing.md` → the `get_brand_context` tool reading the projection from the brain). Cross-cutting skills (writing-quality, banned words) follow the template's `defineSkill` factory pattern.

## Policy: effect signatures, not tool lists

Risk is not classified semantically but by **effect signature**, from a closed vocabulary: `reversible-external`, `irreversible-external`, `communication`, `financial` — with scope and blast radius. Actions that only mutate the work graph are reversible by construction and always allowed as proposals; boundary actions (the MCP connectors) carry the class assigned at connector registration.

`packages/policy` is the pure, deterministic function:

```text
(Actor, effect signature, Intent structure level)
  → allowed | requires-verification | requires-human-approval | denied
```

eve connections enforce the result: per-connection tool allowlists (the precedent is Resend cut from ~85 to 47 tools in the template) and approval gates where the function prescribes them. The `policy_snapshot` persisted on every Action turns "why are you asking me to approve this?" into a query with a mechanical answer. Determinism covers the gate, not the judgment inside the gate: the outcome of a verification still belongs to the actors.

## Channels and surfaces

The web console (`apps/app`) is the primary surface (ADR-003) and it is **a view over the graph, not the foundation of the system**:

1. **Approval inbox** — the main surface: what awaits human judgment
2. **Digest with citations** — a narrative of what happened on your intents, where every rendered claim carries a reference to the canonical objects backing it
3. **Graph browser** — backward traversal: from any object to the Intents and Decisions that justify it
4. **Chat** — only natural-language intent entry (transduction), never a place of truth

A carved-in-stone rule (from the CRM): **no intelligence in the console routes.** Routes read projections and write only intents and approvals through `packages/brain`. The anti-metric is explicit: human time in the console must trend down at constant work output. A console that creates engagement is failing.

## Data flow: the onboarding loop

The product wedge — the first full turn of the flywheel:

```text
self-serve signup → org + brand with website_url
  → Intent: "build the brand brain"
    → product-marketer: fetch the site, extract the brand kit (logo, colors, fonts),
      interview the user, brand context v0 with graded claims
    → cmo: first-week plan (marketing-plan skill)
  → proposals land in the approval inbox
    → the human approves / edits
  → the first Decisions enter the graph: the loop is closed
```

## Schedules and the feedback loop

The agent books its own follow-ups: `scheduleRecheck` writes a row in `tasks` with `due_at` and a **rationale shown to the human** — an agent that cannot say why it will be back in fourteen days does not have a reason, it has a default. eve schedules (e.g. daily brief, weekly SEO audit) lease due rows and start one session per row; two dispatchers take disjoint work thanks to the lease.

The analytics feedback loop is a Verification: measured metrics are compared against what the authorizing Decision claimed, and the outcome re-enters the graph as a judgment. This is the compounding byproduct: the judgment dataset.

## Credits

The Magister model: a monthly credit pool per plan, consumption metered at the AI Gateway and by action type, overage at a unit price. The `credit_ledger` is append-only: even billing speaks the grammar.

## Integrity metrics (CI)

Part V of the ADE document becomes automated tests — the system's type-check:

- **Provenance completeness = 100%**: every Object has a valid producing Action
- **Policy replay**: re-evaluating the persisted `policy_snapshot`s yields the same outcomes
- **Projection rebuildability**: every materialized view can be rebuilt from the Action log
- **Effect-signature coverage**: every boundary Action has an assigned class

## Roadmap

- **Phase 0 — Product foundations**: `packages/db` + `packages/brain` + `packages/policy`; auth (Better Auth, Google) with orgs/brands; eve mounted in `apps/app`; CMO + product-marketer; onboarding loop v0; console v0 = intent entry + object browser
- **Phase 1 — The team that delivers**: + content, distribution, seo-discovery; Notion/Typefully connections with effect-signature allowlists; approval inbox; artifact handoff by id
- **Phase 2 — The habitable graph**: supersession UI for Decisions, digest with citations, live tasks queue, first schedule (daily brief)
- **Phase 3 — Feedback loop**: lifecycle + Resend; analytics connection; Verification objects; credits and billing
- **Phase 4 — Scale**: growth as a remote agent with its own ads credentials; public self-serve launch

## References

| Link | Covers |
| --- | --- |
| [eve documentation](https://eve.dev/docs/introduction) | The framework: agents, subagents, skills, channels, schedules, HITL |
| [marketing-team-eve-template](https://github.com/vercel-labs/marketing-team-eve-template) | The tactical precedent: `agent/` layout, approval matrix, credential model |
| [trycompai/crm](https://github.com/trycompai/crm) | The operational precedent: work queue, deny-all sandbox, autonomous agent |
| [marketingskills](https://github.com/coreyhaines31/marketingskills) | The marketing capability taxonomy |
| [Magister](https://magistermarketing.com/) | The product benchmark |
