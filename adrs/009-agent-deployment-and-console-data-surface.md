# ADR-009: Standalone root-agent deployments and the console's data-surface discipline

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), grilling session on [trycompai/crm](https://github.com/trycompai/crm) `docs/api.md`
- **Amends:** [ADR-003](003-web-console-eve-in-app.md) — the console primacy stands; the deployment topology is reversed
- **Builds on:** [ADR-007](007-approvals-and-tasks-queue.md), [ADR-008](008-brain-write-path-and-model-resolution.md)
- **Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) — agent claims start one task-mode session; bounded reclaim remains only for eligible direct work
- **Amended by:** [ADR-019](019-human-approved-external-commitments.md) — human commitments execute one-shot in the responsible root, and brand deletion cascades all internal rows instead of cancelling a surviving queue

## Context

A grilling on the CRM's `docs/api.md` — 592 lines of incident-born rules — surfaced six questions for our architecture. One answer reverses a standing decision: ADR-003 chose `withEve()` mounted in `apps/app`; the Q1 discussion (the no-intelligence line loses its physical enforcement when agent and console share a process) led to adopting the CRM's topology instead.

The first formulation of this ADR put the CMO and all named specialist roots in one standalone `apps/agent` deployment. Further implementation review rejected that multi-agent mount: the intended topology is one real eve application and Vercel deployment per root, with shared definitions preventing the two materializations of each specialist from drifting.

The normative runtime surface for this ADR is eve 0.31.3. In particular, public sessions are addressed by their immutable `session_id`, while authored custom channels own their channel-local addresses and expose `from(address).send(...)` inside route handlers.

## Decision

### 1. Seven standalone root apps; only the CMO is user-addressable (amends ADR-003)

- The monorepo has exactly **seven eve root applications and deployments**: `agent-cmo` plus one for each of the six specialist roots (`product-marketer`, `content`, `distribution`, `seo-discovery`, `lifecycle`, and `growth`). They are not named agents mounted under one eve application.
- `agent-cmo` authors the normal `eveChannel` with bridge authentication and is the only user-addressable root. `apps/app` never mounts eve; its authenticated same-origin `/eve/v1/*` proxy targets **only `agent-cmo`**.
- The six specialist roots are machine-only. Because eve 0.31.3 enables its default HTTP channel even when `agent/channels/eve.ts` is absent, each specialist explicitly authors that file as `eveChannel({ auth: [localDev()] })`. Consequently `/eve/v1/session*` and `/eve/v1/info` are available to local development tooling but return `401` in production; `/eve/v1/health` remains public for health checks. Omitting the file is not equivalent: the framework default does not express this production fail-closed policy.
- **The bridge** follows the CRM pattern: browser → `/eve/v1/*` (same origin, session cookie) → a proxy route in `apps/app` checks the Better Auth session, strips the cookie, mints a short-lived HS256 token naming the human principal with `CMO_BRIDGE_SECRET` → the CMO root's `/eve/v1/*`. Only `apps/app` and `agent-cmo` receive this credential. The CMO remaps the token to a real user principal (their `repFromCrm` pattern): eve's `jwtHmac()` alone resolves to `principalType: "service"`, while the CMO needs the human identity for tenant ACLs, read capabilities, and Actor attribution. External-commitment approval remains an `apps/app` transaction authenticated directly by Better Auth (ADR-019).
- Record context travels **in the token claims, never prefixed into the user's message**.
- Every root authors a machine-only custom `dispatch` channel whose route table contains `POST /internal/dispatch`. The route authenticates a raw `Authorization: Bearer $DISPATCH_SECRET` and fails closed when the configured secret or bearer is absent or invalid. `DISPATCH_SECRET` is present in `apps/app` and all seven roots, but authorizes only this poke route; it is never accepted as a user token and cannot sign the CMO bridge's HS256 human-principal JWTs.
- In a specialist production deployment, `/internal/dispatch` is therefore the only ingress that can create agent work. After an atomic agent-task claim, the custom-channel handler delivers the authoritative brief with `from(taskAddress).send(message, { auth, mode: "task", outputSchema })`; `taskAddress` is derived from the already-trusted task id and is not a public session or continuation token. Only ADR-018's stale unbound-handoff recovery may call `send()` again; a task with an authoritative `session_id` never does. Framework-owned callback routes may remain enabled because they only resume already accepted durable work; they cannot start an unrelated specialist run.
- The architecture does not depend on `disableRoute()` or any other private eve route API. The supported boundary is explicit: only the CMO exposes the default `/eve/v1/session*` surface to the product UI, while specialist `eveChannel({ auth: [localDev()] })` routes fail closed in production and their authenticated custom dispatch route remains available.
- The no-intelligence line is **physical**: the console, CMO, and six specialist roots are separate processes and deployments. Inside each app it is also **mechanical**: Biome restricted imports keep console routes and Server Actions on `packages/brain`, never agent runtime code. Their war story stands as the justification: copied identity matchers drifted silently until one matched every employer on earth; a shared process makes that drift one autocomplete away.
- What stands from ADR-003: the console as primary surface, the four surfaces, and the two carved-in-stone rules. What changes: all eight runtime apps (`app` plus seven roots; `web` is separate) have explicit deployment boundaries from the beginning. An unreachable root is `offline`, not `working`.

### 1a. One shared definition, two specialist materializations

`packages/agents` is the source of truth for every agent identity, core instructions, skills, model defaults, task kinds, and mode-specific surfaces. It exports canonical definitions and reusable eve workspace-extension contributions; each standalone app keeps only thin local wrappers for root-only configuration and mounting. It materializes:

- the CMO root together with all six **consultative declared-subagent** forms inside `agent-cmo`;
- one **durable root wrapper** inside each corresponding specialist app.

The consultative and durable forms intentionally differ in authority and contract (ADR-017), but their shared specialist core is generated from the same entry. Hand-maintained copies are forbidden. Eve extensions may share skills, tools, connections, instruction fragments, and hooks. Agent configuration and sandbox policy remain consumer-local; schedules and custom channels are root-only and remain in each root wrapper. This is what prevents a root deployment and the CMO's local subagent version of that specialist from drifting without pretending that every eve filesystem slot is extension-mountable.

### 1b. One Next.js cron fans out; each root drains only its own work

- A single Vercel Cron invokes a route in `apps/app`. That ingress verifies `Authorization: Bearer $CRON_SECRET`; there are no eve schedules.
- `CRON_SECRET` belongs only to the Vercel cron ingress and the receiving route in `apps/app`. The route never forwards or reuses it; outgoing root pokes use `DISPATCH_SECRET`.
- The route sends seven `POST /internal/dispatch` requests in parallel, one per root. Each request has an independent two-second timeout, and `Promise.allSettled` waits only for the seven acknowledgments. A failed or offline root does not prevent the other six from being poked.
- Each root's custom-channel route validates machine authentication, responds `202 Accepted`, and registers its drain with `waitUntil`. For every claimed agent row, that drain uses the route-scoped `from(taskAddress).send(...)` operation described above. The acknowledgment does not mean the queued work has completed.
- `/internal/dispatch` is a pure wake-up signal. Its contract accepts no `task_id`, `brand_id`, payload, `worker_key`, or target root. The called deployment is the target, and its dispatcher derives both `SELF` and `compiledSupportedKinds` from its compiled registry materialization. Before the ordinary drain it also terminalizes only its own stale `direct/human` rows according to ADR-019; it never requeues or re-executes them. New claims filter `worker_key = SELF AND kind IN compiledSupportedKinds` before any lifecycle mutation; possession of `DISPATCH_SECRET` therefore cannot select work for a root to execute.
- Every task carries a registry-derived `worker_key` and `execution_mode: agent | direct`. A root claims only `worker_key = SELF AND kind IN compiledSupportedKinds`, regardless of lane. Agent mode enters that root's eve session; direct mode runs deterministic code inside that same responsible root. In particular, deterministic execution of a human-approved commitment belongs to the root that owns its task, not to a central dispatcher in `apps/app`, the CMO model, or a resumed eve tool.
- A due row whose kind is not compiled into the running root is left completely untouched: no status change, session start, lease, attempt increment, fallback lane, or generic agent brief. A later compatible deployment can claim the same row. Published task-kind payload and output contracts therefore change only backward-compatibly. A breaking change uses a new kind, or an explicit expand-contract rollout in which consumers accept both shapes before producers emit the new one and legacy support is removed only after old rows drain. V1 adds neither a `contract_version` column nor a deployment coordinator.
- A process-local `collapsing()` guard is a best-effort optimization against overlapping drains within one warm instance. Cross-instance correctness comes from atomic Postgres lifecycle transitions. Agent rows claim `queued → running` once; retry-safe direct/automatic rows may use their bounded lease for transactional internal work or side-effect-free idempotent external reads; human external commitments also claim once but have no reclaim after `running`. Duplicate or overlapping cron invocations and pokes are therefore safe; the next cron tick both backs up work that remains claimable and lets each healthy root terminalize its own human commitments older than `STALE_AFTER` without another provider call.
- Each root has configured, bounded `STALE_SCAN_LIMIT`, `CANDIDATE_SCAN_LIMIT`, and `DRAIN_BATCH` values; they are runtime configuration, not task priority. Stale classification runs first but stops at its own limit so a backlog cannot consume the ordinary drain. The drain then scans candidates lane by lane until it records `DRAIN_BATCH` successful claims or reaches its separate scan/runtime bound: first claimable `direct/human` rows ordered by `execute_before ASC NULLS LAST`, denormalized `approved_at`, then task id; then due `direct/automatic` rows by `created_at, id`; then due agent rows by `created_at, id`. The latter two FIFO queries filter `due_at <= now()` before ordering. Preflight terminalizations or diagnostics that do not win `queued -> running` consume no execution slot. Existing work is never preempted, and a human task arriving after the batch snapshot waits for the next poke.
- `DRAIN_BATCH` limits one invocation, not total root concurrency. Overlapping instances apply the same lane order and claim disjoint rows through the existing atomic guards; together they may start more than one batch. This is admission preference at each claim snapshot, not a global start/completion order, concurrency semaphore, or serial scheduler.
- This deliberately adapts rather than copies the current CRM's [`RUN_BATCH = 20` plus `createdAt, id` FIFO](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/lib/custom-agent-dispatch.ts#L256-L270). Its queue contains homogeneous `AgentRun` rows. Branderize shares a root dispatcher across three lanes, so FIFO remains inside each lower lane while an already-authorized external commitment receives the first claim opportunity. Sustained human-commitment load may starve both lower lanes, and sustained automatic-direct load may starve agent work. V1 accepts and measures both conditions; no quota, weighted scheduler, global semaphore, or persisted priority is added before starvation occurs in practice.
- Per-brand cadences remain rows in `tasks.due_at`. The cron decides no marketing schedule and dispatches no work itself; it only pokes all seven owners to inspect their due rows.

### 2. Explicit tenancy, never ambient (Q2)

- `brand_id` is the **first parameter of every `packages/brain` function**. No AsyncLocalStorage tenant context, no ambient scoping: the console resolves org/brand from the URL once at the route boundary and passes it down explicitly. A missing `brand_id` is a type error, not a silent cross-tenant read.
- Slugs are cosmetic prefixes only: one slugify function, a reserved-slug guard (a brand named "settings" gets a suffix), no read takes them, no record carries them.

### 3. The console's data layer (Q3)

- **Server Components read projections** via `packages/brain` reads; **Server Actions** perform the few writes (`declareIntent`, `approveTask`, `dismissTask`, settings-via-brain); zod validates at the action boundary.
- Filtering, sorting, pagination **always in SQL** — never return a whole table and filter in the browser. Sort keys resolve against a per-module column allow-list, never interpolated into field names.
- Thin actions, thick brain. No tRPC, no separate API service.

### 4. Freshness: agent writes are not invalidations (Q4)

- Work the browser did not cause (an agent producing an Object while the human watches) cannot be a cache invalidation — **poll**, gated on active work (`awaiting_approval`, `queued`, or `running` tasks), and stop when settled. **Lists poll too, not just detail views** (their logo-in-the-sheet-but-not-in-the-table bug).
- User-caused mutations invalidate through **one cache module** that owns the fan-out — *"say what changed, not which keys"*; twelve hand-written key lists is how theirs drifted.
- No SSE/websocket in v1: eve already streams sessions for chat; everything else is polling. Reopen in Phase 2 if the digest wants live updates.

### 5. Deletion vs automation — including objects outside branderize (Q5)

- **During a brand's lifetime, grammar history is not rewritten.** Objects supersede or are dismissed, tasks settle, and Actions append. Tenant deletion is the explicit exception: all internal brand-scoped rows have a real foreign-key path to `brands` with `ON DELETE CASCADE` and are hard-deleted together.
- **External manifestations are outside that cascade.** Superseding internal content does not automatically retract, update, or delete anything at a provider. If a correction, replacement, pause, unpublish, cancellation, or close is desired, it is a new registered human-approved commitment task. Previously accepted provider state may remain after brand deletion and become orphaned.
- **External drift is user-owned in v1.** A human editing provider state or switching the active provider account does not mutate our Objects and does not trigger a generic readback/hash or reapproval protocol. The click authorizes the current registered provider operation; the Action and receipt record what Branderize did, not a claim that external state stayed unchanged beforehand.
- **A call already in flight can outlive deletion.** The database prevents any later internal claim because the row no longer exists, but cannot revoke an HTTP request already started. Brand deletion performs no provider cleanup and the dispatcher does not perform an additional “brand still exists” check beside referential integrity.

### 6. Gates surface their accumulation (Q6)

- Every optional capability gets a **visible counter of the work waiting on it** ("3 proposals need Notion connected"). A gate either has no escape hatch or surfaces what the escape accumulates — their Skip button stranded installs with companies `PENDING` forever and nothing saying so.
- The UI's disabled state and the gate's denial read the **same `packages/policy` evaluation** — the button and the 403 can never disagree.
- Credit exhaustion is lane-specific rather than a generic capability denial: its counter covers queued agent-session work. It never disables approve or cancel controls for `direct/human`, and it does not keep an approved commitment from execution.

## Consequences

- Monorepo: seven standalone eve apps (`agent-cmo` plus six specialist apps) join `apps/app` (console) and `apps/web`; there is no multi-agent `apps/agent` mount.
- `packages/brain`: `brand_id`-first signatures; typed preparation, approval, explicit pre-claim cancellation, dismissal, supersession, and result operations for commitment tasks.
- Console: the `/eve/v1/*` proxy route, the cache module, gated polling hooks, capability counters.
- ADR-003 is amended; ADR-006's dual declaration remains, but its original same-deployment multi-agent mount is superseded by the seven-root topology above.
- Deployment configuration includes the CMO endpoint for the user proxy and all seven internal dispatch endpoints for cron fan-out. Credentials are capability-scoped and never substituted for one another:

  | Credential | Installed in | Sole authority |
  | --- | --- | --- |
  | `CMO_BRIDGE_SECRET` | `apps/app`, `agent-cmo` | Mint and verify short-lived HS256 JWTs representing Better Auth human principals on the CMO proxy |
  | `DISPATCH_SECRET` | `apps/app`, all seven root deployments | Authenticate a raw Bearer request to `POST /internal/dispatch` |
  | `CRON_SECRET` | Vercel cron ingress, the `apps/app` cron route | Authenticate the scheduled invocation into `apps/app`; never forwarded |

  Specialist roots receive `DISPATCH_SECRET` but not `CMO_BRIDGE_SECRET`; compromising a specialist's dispatch credential therefore does not confer user-impersonation authority at the CMO boundary.
- Route-contract tests verify that a production specialist returns `401` for `/eve/v1/info` and every `/eve/v1/session*` operation, keeps `/eve/v1/health` public, and cannot start work except after its authenticated dispatcher has claimed a task. Dispatch tests also verify that a root leaves unsupported kinds untouched; an agent task always uses task mode and is never redispatched after authoritative `session_id`; a human external commitment requires its Approval Action and is never reclaimed after `running`; a serialized commitment claim revalidates its trusted conflict key; only its provider connector interprets HTTP/SDK outcomes and returns the closed `accepted | rejected | unknown` result; the generic dispatcher uses an exhaustive switch and maps unexpected throws to unknown; and only the owner root classifies it after `STALE_AFTER` with an `unknown` Result Action in the same transaction as `outcome_unknown`. Given a constrained batch, an already-claimable human commitment is selected before older direct/automatic or agent rows, earliest non-null `execute_before` wins within that lane, and remaining capacity preserves FIFO in the lower lanes; blocked or expired candidates do not consume execution slots, and concurrent drains still claim each row at most once. A registered provider-outcome Verification uses only the existing queue and authenticated dispatcher: no provider webhook route or event inbox exists; each pending poll technically succeeds and creates exactly one stable-key successor; provider-domain failure does not fail the poll task; deadline and technical exhaustion record distinct terminal `unverified` facts. Approval concurrency tests run across root kinds and instances: one shared conflict key yields one Approval Action plus one `queued` task, while the loser remains `awaiting_approval` with `target_busy`; different brands, keys, and independent kinds do not conflict. Retry-safe direct/automatic tests remain separate. Local development verifies that `eve dev`, the TUI, and SDK diagnostics continue to work through `localDev()`.

## Alternatives considered

- **`withEve()` in-app** (original ADR-003) — superseded: the no-intelligence line loses physical enforcement exactly where drift is cheapest.
- **One standalone multi-agent eve deployment** (the first version of this ADR) — superseded: it conflates independently owned durable roots and relies on named-agent mount routing that the selected topology does not use.
- **One secret for bridge JWTs and dispatch pokes** (the CRM's `AGENT_BRIDGE_SECRET` shape) — rejected: all six specialist deployments would receive a credential capable of impersonating humans at the CMO boundary.
- **One dispatch secret per root or workload-identity/OIDC authentication** — not adopted in v1: a shared `DISPATCH_SECRET` exposes only a payload-free wake-up route whose called deployment still applies its compiled root and kind allowlists; seven rotations or an identity-provider integration add operational machinery without widening that route's authority.
- **Leave the specialist `eveChannel` implicit** — rejected: eve 0.31.3 enables the channel by default, whereas specialist production session routes must fail closed independently of framework defaults.
- **Disable the framework channel through a private route API** — rejected: the architecture targets only eve's supported public surface. `eveChannel({ auth: [localDev()] })` preserves local tooling and fails closed in production without relying on `disableRoute()` or another private seam.
- **Per-row `contract_version` plus a deployment coordinator** — not adopted in v1: the compiled kind allowlist makes version skew fail closed, while backward-compatible contracts and new kinds or expand-contract rollouts cover schema evolution without adding another queue state machine.
- **Let tasks and Actions survive brand deletion** — rejected by ADR-019: durable work survives process and deployment failure, not deletion of its tenant. Real foreign keys cascade every internal brand row; provider resources are deliberately outside that promise.
- **SSE from v1** — deferred to Phase 2; polling gated on in-flight work covers the console's needs.
