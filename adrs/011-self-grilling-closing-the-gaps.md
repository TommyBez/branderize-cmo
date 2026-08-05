# ADR-011 — Self-grilling: delegation guards, the CMO's job list, closing the verification loop, budget hierarchy, proposal shape, one schedule, human roles

**Status:** Accepted — 2026-08-05
**Amends:** ADR-006 (delegation guard), ADR-007 (dedup extends to the interactive path), ADR-010 (the CMO after plan compilation)
**Refs:** ADR-002 (work graph), ADR-009 (capabilities, counters), trycompai/crm (one-schedule rule, normal endings, `mirror()`), Magister (impact baselines, edit-before-approve, signed URLs, org roles)

## Context

A grilling session against our own ADR stack (001–010 + ARCHITECTURE.md), looking for places where two ADRs fail to compose or where a rule was cited but never formally adopted. Seven gaps surfaced; each got a decision. One floated idea (skill versions in provenance) was rejected and is recorded with its reasoning.

## Decisions

### D1 — The delegation-time in-flight guard (both doors dedup)

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

### D3 — The verification loop closes into work, not just data

"The outcome re-enters the graph as a judgment" was where the feedback loop description stopped — a negative judgment would have sat in the graph with no one collecting it. Two rules close the loop:

- Every measurable Decision **declares its verification plan at creation** (metric, baseline, horizon — Magister's "impact baseline captured"). A Decision without a verification plan is a low-structure object and surfaces in open questions.
- A negative judgment marks the Decision **contested** in the console and **enqueues a CMO task** to propose a motivated supersession. The loop closes into new work.

### D4 — Budget hierarchy: plan cap > brand pool > session budget

Three budget layers inherited from three sources now have an explicit nesting:

- **Plan cap** (hard, billing) — the global autonomous-spend ceiling of ADR-006
- **Brand monthly pool** (from the subscription; the Magister credit model)
- **Session budget** (set by the policy at dispatch; autonomous runs get less — the CRM's `focus.ts` pattern)

The dispatcher checks the brand pool **before leasing** agent tasks: at zero, tasks stay queued and the console shows "N jobs waiting on credits" — credits are a capability like any other, rendered with the ADR-009 counter pattern. Running out mid-session is a **normal ending** (CRM rule): the specialist saves the partial work as an Object and exits.

### D5 — Proposal shape: render hint, edit-before-approve, drift check

The approval inbox is the product's main surface, so the proposal Object's shape is specified:

- Proposals carry `{ render_hint, payload, base_state_ref }`; each proposal type has a console renderer (email preview, social card, diff against current state).
- **Edit-before-approve is supported** (Magister: "tweak if you want, then push live"). The human's edit is a separate Action; the executed payload is the edited one; provenance keeps both the agent's draft and the human's delta.
- `execute-proposal` **re-reads external state** when the connector allows it: on drift it does not execute — it reopens the proposal with a note. (Connects to the retract/correct rule of ADR-009 Q5.)

### D6 — Exactly one schedule; binaries in content-addressed blobs

- **One schedule.** The CRM's golden rule is adopted verbatim: the dispatcher tick is the only eve schedule, and it decides nothing. Every cadence — the daily brief at 9 in the brand's timezone, the weekly SEO audit — lives in `tasks.due_at` rows, because per-brand cadences are data, not code.
- **Binary artifacts** (images, video, PDFs) live in content-addressed blob storage: the key carries the byte hash (the CRM's `mirror()` pattern — idempotent re-runs). Objects hold metadata plus the blob key; the console renders via short-lived signed URLs (Magister's rule).

### D7 — Human roles are part of the Actor the policy reads

Multi-user orgs need approval rights per role, and the policy function reads the Actor — so role must be on it. Default matrix: **owner/admin approve everything, members approve the non-financial, viewers are read-only** — overridable per org via a Decision. Four-eyes on `financial` (approver ≠ intent author) is deferred to Phase 3.

## Rejected: skill versions in action provenance

The grilling floated recording a `skill_snapshot` on Actions, since a marketingskills submodule update changes agent behavior. **Rejected by the maintainer:** skills are content chosen at deploy time, exactly like application code — and the app deploy is not in `policy_snapshot` either. `policy_snapshot` exists because policy is *evaluated at runtime* on every action and must be replayable; skills are static inputs versioned by git. Syncing with upstream is a deliberate choice, not an obligation: the submodule starts from Haines' collection because it is good and verified, and may later be replaced by self-written skills.

## Deferred notes

- **Org deletion / GDPR export** — Phase 4. The append-only log pushes toward crypto-shredding-style erasure (per-org encryption keys, deleted on request); to be designed with billing.
- **Cross-brand intents** (an agency running one campaign across three client brands) — out of scope for now; every grammar-layer row stays scoped by exactly one `brand_id`.
