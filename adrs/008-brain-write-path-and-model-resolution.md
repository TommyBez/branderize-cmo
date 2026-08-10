# ADR-008: Brain write-path rules, tool design, and model resolution

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), grilling session with assisted analysis
- **Builds on:** [ADR-002](002-postgres-work-graph.md) (single write path), [ADR-006](006-dual-declaration.md) (shared registry), [ADR-007](007-approvals-and-tasks-queue.md) (queue and approvals)
- **Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) — the task channel starts one task-mode session and stores its single `session_id`
- **Amended by:** [ADR-019](019-human-approved-external-commitments.md) — executable proposals are human-activation direct tasks; dismissal memory is exact task payload identity, and external preparation is create-only

## Context

A second dig into [trycompai/crm](https://github.com/trycompai/crm) (`lib/facts.ts`, `channels/crm.ts`, `lib/enrichment.ts`, `lib/model.ts`, `packages/db/src/settings.ts`, `agent/agent.ts`, `docs/agent.md`) surfaced disciplines that their incident history produced. These are not features to copy but rules whose violation they already paid for. Three clusters: how the write path behaves, how tools are designed, and how the model is chosen.

## Decision

### 1. Write-path rules (`packages/brain`)

The single write path (ADR-002) enforces in code — never in prompts:

- **Never overwrite a human.** Content written by a human actor outranks anything an agent found. Human ownership is computed from *provenance* (the actor type of the producing Action), not from a flag on the row.
- **Never re-offer an exact dismissal.** For graph Objects, normal supersession/dismissal remains explicit. For an executable proposal, ADR-019 moves the lifecycle to the direct task: terminal `dismissed` plus a Dismissal Action blocks the same `(brand_id, kind, canonical payload hash)` until an explicit human reopen Action.
- **Never write without evidence.** Below the evidence floor, content is not even stored. Claim grading (`proven / plausible / assumption`) is priced by the write path from what the tools *observed* — no tool accepts a confidence offered by the model as proof.
- **Mutations are one transaction**: supersede the prior Object + create the new one + update the projection, atomically. *"Never overwrite a human" is only true if the transaction says so* — hence integration tests against real Postgres.
- **Tool results instruct the model.** Creating a human-activation task returns: *"Prepared for human review. This is a normal outcome, not a failure."* A model told “rejected” will game the score; a model told “normal outcome” moves on. The returned task id is an observation, not authority to queue or execute it.

### 2. Tool design rules

- **ids-on-every-read.** Every brain read returns the ids of neighbouring objects (intent, decisions, artifacts). *"A preamble or tool result that names a record without its id is a bug"* — the only recovery left to the agent is asking the human, which hands the join back to the user. The graph must be traversable without ever asking "can you paste the id?".
- **Capabilities and connections are per-brand.** Which connections *this* brand has (Notion connected? Resend domain verified?) is declared in the specialist's session preamble, so it plans around what exists. Checked **before** the session budget is charged; a missing connection is never an error and never throws. The durable connection record and credential/installation reference belong to `brand_id`, never to the Better Auth user who completed onboarding. That human is the audited Actor of connect/disconnect, not the later credential owner. This is a planning snapshot, not a pinned provider account: an ADR-019 commitment handler resolves the brand's current active connection and records the account actually used in its result receipt.
- **External preparation is a closed create-only surface.** A durable root may receive an authored provider-draft operation only when the registry marks that provider state as non-committal. The tool cannot update/delete a previous draft or select its own connector method, effect class, worker, or commitment status. Every external commitment is prepared as a human-activation task and executed later by plain code (ADR-019).
- **The brand context splits in two.** The full document is an Object in the brain (owned by the product-marketer, ADR-004); what rides in every session preamble is a **size-capped extract**, with the cap enforced by the write path, not by the prompt asking nicely (their "Who we are": 320 chars + 3 lines, `MAX_NARRATIVE` in code). The extract is prompt-cached — paid once, read on every turn; the full document is fetched on demand via tool. The eve template's single 20k-char document in every prompt is the anti-pattern. Two sub-rules from the same source: the extract **states what the context is for** (usage instructions for the reader — for us: "claims are graded; hedge on assumptions" — because a model with facts and no instruction starts selling our own product back to us), and it **dies with the website**: a change to the brand's `website_url` marks the extract stale and enqueues a product-marketer rebuild task, with a stand-down cooldown after a finished rebuild so an unreadable site is not re-fetched at cost on every sweep forever.

### 3. Model resolution chain

The model is a resolver, not a constant. Their entire mechanism is 15 lines: `defineAgent({ model: defineDynamic({ fallback, events: { "session.started": () => selectedModel() } }) })`.

- **Three levels**: global compiled fallback → per-specialist default in the `packages/agents` registry (the seo-analyst wants a long window, distribution wants speed) → per-brand override as a **Decision object** in the work graph (author, rationale, supersession chain; the console settings page writes it through `packages/brain` like everything else — a plain settings row has no provenance, and ADR-002 forbids that for normative choices).
- **One resolver in `packages/agents`**, shared by both declarations of each specialist (subagent + named root, ADR-006) — no drift.
- **The resolver always returns the pair** `(model, contextWindowTokens)`: eve does not inherit the window from the fallback, and a smaller-window model compacted against a number it does not have fails at the provider *after* the context has been assembled and paid for.
- **Degrades, never throws**: no row, DB down, resolver error → compiled fallback, reason logged. The alternative is a session quietly running on a model nobody chose.
- **Budget tie-in**: the Policy function takes the resolved model as an input — autonomous sessions of a budget-tight brand can resolve to cheaper models while interactive ones get the strong one. Cost control as a policy input, not a prompt plea.
- **"Not a frontier model, on purpose."** Reliability is bought on the write path and the policy, not on model size. What sessions actually want is window length and answer speed.

### 4. Operational traps recorded for Phase 0/1 (from their post-mortems)

- In eve 0.31.3, a human CMO conversation has a stable Branderize id, one owner, and only the fixed client cursor `{ sessionId, streamIndex }`. Its first message uses `client.sessions.create({ message })`; a follow-up uses `client.sessions.attach(sessionId, { streamIndex })` and then `send()`. `attach()` never creates or follows another session, so a terminal/reset session requires an explicit new application conversation and a new `create()` call rather than silently replacing the old binding. The task custom channel remains separate: it owns its deterministic `task:<task_id>` token, attempts one `mode: "task"` run, and binds the authoritative returned `session_id` through `session.started` plus a post-send fallback. Only an unbound delivery may be recovered (ADR-016, ADR-018).
- **`eve dev` never fires schedules.** The poke pattern (write the task row → fire-and-forget poke to the dispatch route → drain; cron as backstop) makes dev behave like production. *"An agent that is down costs sixty seconds, not the work."*
- eve's `jwtHmac()` resolves to `principalType: "service"`: any bridge carrying a human must remap the principal so identity, tenant ACLs, read capabilities, and Actor attribution see the real user. External-commitment approval does not run inside eve; `apps/app` evaluates it from the Better Auth session (ADR-019).
- **Eve has no brand connection principal.** Eve 0.31.3 connection principals are `app` or `user`; neither replaces the application's brand owner. The human CMO bridge and machine task auth both carry an application-verified `brand_id`, and a shared credential provider resolves the matching brand-owned connection through dynamic connection auth/headers or authored tool code. `toolCall.providedArguments` may hide and inject a trusted brand or remote-account argument for MCP/OpenAPI, but it neither performs the ACL check nor chooses or stores the credential. Interactive Eve OAuth remains user-scoped and is not the ownership model for a headless brand grant; `apps/app` owns brand connection onboarding and persists only the provider/installation reference needed by the broker.
- **Machine routes fail closed**: an unset credential means the route *refuses* rather than opens — the absence of an optional capability must never widen access. The CRM's single `AGENT_BRIDGE_SECRET` is precedent for that fail-closed rule only, not our configuration name or authority model. ADR-009 splits human-principal signing (`CMO_BRIDGE_SECRET`), dispatch pokes (`DISPATCH_SECRET`), and cron ingress (`CRON_SECRET`) so possession of a wake-up credential cannot impersonate a user.
- The audit hook writes **every session event to our DB**; console transcripts read from our tables, not from eve (which retains sessions 30 days). This is also what feeds the digest and the graph browser.

## Consequences

- `packages/db`: Object lifecycle and evidence metadata remain; executable-proposal lifecycle, exact dismissal memory, and approval/result links live on tasks and Actions (ADR-019).
- `packages/brain`: the write functions implement the three rules and the transaction discipline; tool results are crafted messages, not bare statuses.
- `packages/agents`: registry entries declare `(model, contextWindowTokens)` defaults; the shared resolver; the preamble builder (brand-context extract + per-brand capabilities + ids).
- Console: the brand settings page shows the effective resolution chain (brand override → specialist default → global) — provenance made visible.
- CI integrity metrics gain two entries: every Object carries a lifecycle status; an exactly dismissed commitment payload is not recreated without a human reopen Action.

## Alternatives considered

- **Model as env var or per-agent constant** — rejected: redeploy to change; impossible per-brand.
- **Model choice as a plain settings row** (their `AppSetting`) — rejected *for us*: multi-tenant, and ADR-002 makes normative choices versioned Decisions with provenance.
- **Brand context as one full document in every prompt** (the template's approach) — rejected: crowds out the actual work and is paid at every turn; the extract/full split is the CRM's lesson.
- **Enforcement by prompt** ("please don't overwrite human edits") — rejected: everything in this ADR exists because the CRM team watched prompts fail at exactly this.
