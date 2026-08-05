# ADR-009: The agent as its own deployment, and the console's data-surface discipline

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), grilling session on [trycompai/crm](https://github.com/trycompai/crm) `docs/api.md`
- **Amends:** [ADR-003](003-web-console-eve-in-app.md) — the console primacy stands; the deployment topology is reversed
- **Builds on:** [ADR-007](007-approvals-and-tasks-queue.md), [ADR-008](008-brain-write-path-and-model-resolution.md)

## Context

A grilling on the CRM's `docs/api.md` — 592 lines of incident-born rules — surfaced six questions for our architecture. One answer reverses a standing decision: ADR-003 chose `withEve()` mounted in `apps/app`; the Q1 discussion (the no-intelligence line loses its physical enforcement when agent and console share a process) led to adopting the CRM's topology instead.

## Decision

### 1. The agent is its own deployment; the console reaches it through an authenticated proxy (amends ADR-003)

- `apps/agent` ships separately — the CRM topology. `apps/app` never mounts eve.
- The no-intelligence line is **physical again**: separate processes, separate deploys, separate release cycles. Inside each app it is also **mechanical**: Biome restricted imports — console routes and Server Actions import only from `packages/brain`, never from agent code. Their war story stands as the justification: two identity matchers copied across `apps/api` and `apps/agent` drifted silently until one matched every employer on earth; in a shared process that drift is one autocomplete away.
- **The bridge** (their pattern): browser → `/eve/v1/*` (same origin, session cookie) → a proxy route in `apps/app` checks the Better Auth session, strips the cookie, mints a short-lived HS256 token naming the human principal → `AGENT_URL/eve/v1/*`. The agent side remaps the token to a real user principal (their `repFromCrm` pattern): eve's `jwtHmac()` alone resolves to `principalType: "service"`, which would make principal-aware approvals (ADR-007) refuse a human sitting there watching — trap recorded in ADR-008 §4.
- The record context travels **in the token claims, never prefixed into the user's message**.
- Machine routes on the agent (the dispatch poke, internal routes) are authorized by a shared secret and **fail closed** (ADR-008 §4).
- What stands from ADR-003: the console as primary surface, the four surfaces, the two carved-in-stone rules. What changes: "one deployment instead of three" becomes **two** (`app` + `agent` — we never had their Nest API; the console's data layer is §3 below).
- Costs accepted: two deployments, `AGENT_URL` / `AGENT_BRIDGE_SECRET` in both processes (declared in turbo `passThroughEnv` — their mismatched-secret 401 story), the proxy machinery, and the UX states *"an unreachable agent is `offline`, not `working`"*. Benefits: the physical line, an independent agent release cycle, and Phase 4's remote-`growth` story becomes a pattern we already run.

### 2. Explicit tenancy, never ambient (Q2)

- `brand_id` is the **first parameter of every `packages/brain` function**. No AsyncLocalStorage tenant context, no ambient scoping: the console resolves org/brand from the URL once at the route boundary and passes it down explicitly. A missing `brand_id` is a type error, not a silent cross-tenant read.
- Slugs are cosmetic prefixes only: one slugify function, a reserved-slug guard (a brand named "settings" gets a suffix), no read takes them, no record carries them.

### 3. The console's data layer (Q3)

- **Server Components read projections** via `packages/brain` reads; **Server Actions** perform the few writes (`declareIntent`, `settleProposal`, settings-via-brain); zod validates at the action boundary.
- Filtering, sorting, pagination **always in SQL** — never return a whole table and filter in the browser. Sort keys resolve against a per-module column allow-list, never interpolated into field names.
- Thin actions, thick brain. No tRPC, no separate API service.

### 4. Freshness: agent writes are not invalidations (Q4)

- Work the browser did not cause (an agent producing an Object while the human watches) cannot be a cache invalidation — **poll**, gated on in-flight work (running tasks / pending proposals), and stop when settled. **Lists poll too, not just detail views** (their logo-in-the-sheet-but-not-in-the-table bug).
- User-caused mutations invalidate through **one cache module** that owns the fan-out — *"say what changed, not which keys"*; twelve hand-written key lists is how theirs drifted.
- No SSE/websocket in v1: eve already streams sessions for chat; everything else is polling. Reopen in Phase 2 if the digest wants live updates.

### 5. Deletion vs automation — including objects outside branderize (Q5)

- **Grammar layer: no deletion.** Supersession and dismissal only (ADR-002, ADR-008).
- **External manifestations are the exception to handle explicitly** (the griller's sharpening): superseding an Object that was pushed outside must declare the external effect.
  - `reversible-external` (a Notion page, a scheduled Typefully post): supersession enqueues a **retract-and-replace** task in the execute lane.
  - `irreversible-external` (a sent Resend broadcast, a launched ad): the external effect stands; supersession is internal, plus optionally a **correction** action.
  - The effect signature recorded on the producing Action is what tells the two apart — which is why the signature is fixed at push time, never inferred later.
- **External drift**: a human editing the Notion page directly does not mutate our Objects. Connections read back; drift enters the graph as new Actions/evidence, never as silent edits.
- **Product layer**: deleting a brand settles its queued tasks and disables its schedules **in one transaction**. `tasks` keep plain id columns without foreign keys — the queue survives records and redeploys on purpose — and the delete service cleans up: the dispatcher must never spend a session discovering the brand is gone.

### 6. Gates surface their accumulation (Q6)

- Every optional capability gets a **visible counter of the work waiting on it** ("3 proposals need Notion connected"). A gate either has no escape hatch or surfaces what the escape accumulates — their Skip button stranded installs with companies `PENDING` forever and nothing saying so.
- The UI's disabled state and the gate's denial read the **same `packages/policy` evaluation** — the button and the 403 can never disagree.

## Consequences

- Monorepo: `apps/agent` (the eve deployment) joins `apps/app` (console) and `apps/web`.
- `packages/brain`: `brand_id`-first signatures; `retract` / `correct` task kinds join the execute lane.
- Console: the `/eve/v1/*` proxy route, the cache module, gated polling hooks, capability counters.
- ADR-003 amended; ADR-006's "same deployment" now means **the agent deployment** — dual declaration is unchanged.
- Deployment: two Vercel projects; `AGENT_URL` and `AGENT_BRIDGE_SECRET` shared env.

## Alternatives considered

- **`withEve()` in-app** (original ADR-003) — superseded: the no-intelligence line loses physical enforcement exactly where drift is cheapest.
- **FK cascade on `tasks`** — rejected: the queue surviving records is a feature (retry continuity across supersessions); cleanup is one transaction.
- **SSE from v1** — deferred to Phase 2; polling gated on in-flight work covers the console's needs.
