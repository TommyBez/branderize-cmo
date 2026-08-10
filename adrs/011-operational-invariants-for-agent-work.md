# ADR-011 — Operational invariants for agent work

**Status:** Accepted — 2026-08-05
**Amends:** ADR-006 (delegation guard), ADR-007 (dedup extends to the interactive path), ADR-010 (the CMO after plan compilation)
**Amended by:** [ADR-017](017-consultative-subagents-durable-root-work.md) (D1: replaces "both doors dedup" with read-only consultation plus one durable task lane)
**Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) (D4/D6: agent work is claimed once and runs as one terminal eve task-mode session)
**Amended by:** [ADR-019](019-human-approved-external-commitments.md) (D5/D6: proposal is a human-activation task; external commitment is one-shot and does not use a drift gate)
**Refs:** ADR-002 (work graph), ADR-009 (capabilities, counters), trycompai/crm (one-schedule rule, normal endings, `mirror()`), Magister (impact baselines, edit-before-approve, signed URLs, org roles)

## Context

ADRs 001–010 left several cross-cutting operational rules either implicit or distributed across multiple documents. This ADR consolidates the seven invariants needed for those decisions to compose in production. It also records the rejected `skill_snapshot` idea and its reasoning.

## Decisions

### D1 — The delegation-time in-flight guard (both doors dedup)

> **Superseded by ADR-017.** The adopted eve 0.31.3 public surface exposes no supported atomic wrapper around its generated local-subagent tool, so the pre-check below is not a hard guard. Declared specialist calls are now read-only consultations and intentionally not deduplicated. CMO-requested durable work uses `request_specialist_work`; every producer reaches the same atomic task service, and only the dispatcher may start a named root from a task row it has claimed. The historical decision follows.

ADR-007 founded concurrency on dedup at enqueue per `(kind, brand_id, subject)` — but ADR-006's interactive path (the CMO delegating a specialist in-process) never touches the queue, so a chat-triggered delegation could overlap with a dispatcher-triggered run of the same specialist on the same brand. Optimistic supersession catches the *write* conflict, but the system would pay for two sessions doing the same work and produce a branch to resolve by hand.

The CMO's delegation tool checks the tasks table for leased/running rows on `(specialist, brand_id)` **before delegating**. If a run is in flight, the CMO either waits and reuses its output, or enqueues the request as an interactive-priority task and tells the human it is already running. Dedup is a rule of both entry doors, not just of the queue.

### D2 — The CMO's job list; the daily brief is a task kind

After ADR-010 the CMO no longer authors plans, so its perimeter is written down explicitly:

1. **Transduction** — turning human chat into structured intents
2. **Routing** — one self-contained brief to exactly one specialist
3. **Synthesis** — specialist outputs back to the human
4. **Proposing** roadmap-input Decisions
5. **The daily brief narrative**

The CMO owns no special schedule: the daily brief is a task kind dispatched to the CMO root agent like any other. The brief is a **mechanical skeleton** (yesterday's actions, pending items, due rechecks) plus CMO narrative whose **citations are validated mechanically** — every claim must reference existing object ids, and the renderer rejects invalid references. This is the rule that keeps "digest with citations" (our stated differentiator) safe from hallucination.

### D3 — Decision-impact verification closes into work, not just data

This section concerns analytics and marketing impact, not ADR-019's provider-outcome polling. A provider Verification records whether an accepted command later completed, failed, or became unverified; by itself it neither judges nor contests the Decision that motivated the command. "The outcome re-enters the graph as a judgment" was where the analytics feedback-loop description stopped — a negative judgment would have sat in the graph with no one collecting it. Two rules close that loop:

- Every measurable Decision **declares its verification plan at creation** (metric, baseline, horizon — Magister's "impact baseline captured"). A Decision without a verification plan is a low-structure object and surfaces in open questions.
- A negative judgment marks the Decision **contested** in the console and **enqueues a CMO task** to propose a motivated supersession. The loop closes into new work.

### D4 — Budget hierarchy: plan cap > brand pool > session budget

Three budget layers inherited from three sources now have an explicit nesting:

- **Plan cap** (hard, billing) — the global autonomous-spend ceiling of ADR-006
- **Brand monthly pool** (from the subscription; the Magister credit model)
- **Session budget** (set by the policy at dispatch; autonomous runs get less — the CRM's `focus.ts` pattern)

The dispatcher checks the brand pool **only before claiming `execution_mode = agent` tasks**: at zero, those tasks stay queued and the console shows "N jobs waiting on credits" — credits are a capability like any other, rendered with the ADR-009 counter pattern. The credit gate is not part of a generic task-claim helper. Deterministic direct lanes do not start an AI session; in particular, a `direct/human` commitment already authorized by its Approval Action is claimed even when the pool is zero. Only billable `succeeded` with a stable receipt produces the idempotent `action_charge`/paid overage; ambiguous or unsuccessful outcomes do not. Running out mid-session is a deliberate `partial` `TaskCompletion`: the specialist saves the partial work as an Object, stages the completion, and exits successfully.

### D5 — Proposal shape: a versioned task and derived preview

> **Amended by ADR-019.** An executable proposal is no longer an Object. It is the same direct task that will later execute, initially in `awaiting_approval`.

- Every commitment task kind supplies a typed payload and trusted preview renderer. `kind`, worker, effect class, connector operation, and renderer are registry-derived rather than payload-selected.
- **Edit-before-approve is supported.** An edit valid for the same kind increments the task revision and records the human delta as an Action. Approval re-derives Policy from that final revision; a stale click fails.
- V1 deliberately has no generic provider-state readback/hash gate and no pinned provider account. The human click authorizes the current registered operation through the brand's current active connection. Provider-side edits or account changes made by the user before clicking are their responsibility.

### D6 — Exactly one scheduler poke; binaries in content-addressed blobs

- **One scheduler poke, no eve schedules.** A single Vercel Cron in `apps/app` fans out in parallel to the CMO and six standalone specialist roots; it decides nothing and waits only for their `202` acknowledgments. Every root owns an authenticated custom-channel `POST /internal/dispatch` route. After claiming an agent row, that route's drain starts task mode through eve 0.31.3's public `from(taskAddress).send(...)` operation; the address is derived from the trusted task id, while the returned immutable `session_id` becomes the authoritative run binding. Every cadence — the daily brief at 9 in the brand's timezone, the weekly SEO audit — lives in `tasks.due_at` rows, because per-brand cadences are data, not code. Each root drains only rows whose registry-derived `worker_key` equals itself; atomic status claims make duplicate agent ticks safe. Only retry-safe direct/automatic kinds retain leases and `FOR UPDATE SKIP LOCKED`; they are limited to transaction-safe internal work or side-effect-free idempotent provider reads. A human external commitment never reclaims after it starts (ADR-009, ADR-018, ADR-019).
- **Binary artifacts** (images, video, PDFs) live in content-addressed blob storage: the key carries the byte hash (the CRM's `mirror()` pattern — idempotent re-runs). Objects hold metadata plus the blob key; the console renders via short-lived signed URLs (Magister's rule).

### D7 — Human roles are part of the Actor the policy reads

Multi-user orgs need approval rights per role, and the policy function reads the Actor — so role must be on it. Default matrix: **owner/admin approve everything, members approve the non-financial, viewers are read-only** — overridable per org via a Decision. Four-eyes on `financial` (approver ≠ intent author) is deferred to Phase 3.

## Rejected: skill versions in action provenance

The grilling floated recording a `skill_snapshot` on Actions, since a marketingskills submodule update changes agent behavior. **Rejected by the maintainer:** skills are content chosen at deploy time, exactly like application code — and the app deploy is not in `policy_snapshot` either. `policy_snapshot` exists because policy is *evaluated at runtime* on every action and must be replayable; skills are static inputs versioned by git. Syncing with upstream is a deliberate choice, not an obligation: the submodule starts from Haines' collection because it is good and verified, and may later be replaced by self-written skills.

## Deferred notes

- **Org-wide GDPR export and billing-document retention** — Phase 4. Brand deletion itself is already decided by ADR-019: real foreign keys cascade every internal brand-scoped row, including the otherwise append-only work log. Provider resources are not cleaned up.
- **Cross-brand intents** (an agency running one campaign across three client brands) — out of scope for now; every grammar-layer row stays scoped by exactly one `brand_id`.
