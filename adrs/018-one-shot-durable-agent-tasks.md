# ADR-018 — One-shot Eve sessions for durable agent tasks

**Status:** Accepted — 2026-08-08
**Deciders:** Tommaso, grilling session with assisted analysis
**Amends:** [ADR-007](007-approvals-and-tasks-queue.md), [ADR-009](009-agent-deployment-and-console-data-surface.md), [ADR-012](012-contracts-approval-brief-intents-compiler.md), [ADR-014](014-schema-singletons-sessions-streams-ledger.md), [ADR-015](015-the-registry.md), [ADR-016](016-eve-session-state-persistence.md), and [ADR-017](017-consultative-subagents-durable-root-work.md)
**Refs:** eve 0.31.3 bundled docs (`concepts/execution-model-and-durability.mdx`, `concepts/sessions-runs-and-streaming.md`, `schedules.mdx`, `channels/custom.mdx`, `guides/hooks.md`); current trycompai/crm [`AgentRun`](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/packages/db/prisma/schema.prisma#L699-L747), [scheduled occurrence idempotency](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/lib/custom-agent-dispatch.ts#L187-L254), [one-shot dispatch](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/lib/custom-agent-dispatch.ts#L256-L345), [`session.started` binding](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/hooks/audit.ts#L79-L121), [delivery recovery](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/lib/custom-agent-dispatch.ts#L480-L544), [terminal handlers](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/channels/crm.ts#L149-L200), [`finish_run` staging and terminal settlement](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/lib/run-runtime.ts#L366-L447), and [runner rationale](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/docs/agent.md#L213-L252). CRM pins eve 0.29.4; this ADR copies its application lifecycle while checking protocol details against Branderize's eve 0.31.3.
**Amended by:** [ADR-019](019-human-approved-external-commitments.md) — direct/human external commitments are one-shot without lease or automatic retry; D6/D7 now apply only to registered retry-safe direct/automatic work where stated

## Context

The durable-agent protocol recorded in ADR-007, ADR-016, and ADR-017 reused one eve conversation across up to three dispatcher claims. That conclusion came from a task implementation that is no longer the relevant CRM precedent for autonomous agent runs.

The current CRM runtime models an autonomous execution as one `AgentRun`: one immutable, permission-bounded invocation, one intended eve task-mode session, and one terminal result. A five-minute recovery covers only the uncertain handoff before the accepted `sessionId` is known. Once a session is bound, neither a technical failure nor a missing terminal projection causes the same run to be dispatched again. A later manual request or scheduled occurrence creates a new run with a new idempotency key.

That boundary fits Branderize's durable root work. Each task already has a typed brief, fixed root, capability and budget constraints, canonical Action/Object writes, a structured `TaskCompletion`, and an auditable outcome. Correctness comes from the task and work graph in Postgres, not from inheriting model history or sandbox state from a failed attempt.

Eve 0.31.3 also makes the separation practical. A task-mode session runs to completion or failure and cannot park for human approval. Its Workflow run already survives process crashes and redeploys and resumes from durable step checkpoints; application-level redispatch is not the mechanism that makes an accepted run durable. Interrupted steps may still replay, so graph writes remain idempotent while registered create-only provider-draft preparation must be idempotent, deterministically recoverable, or explicitly duplicate-safe and at-least-once. External commitments are not agent tools (ADR-019).

This ADR applies primarily to `execution_mode = agent`. Its original direct-lane section remains only for retry-safe `execution_mode = direct AND activation = automatic` work: transaction-safe internal operations and side-effect-free idempotent external reads. ADR-019 separately defines `direct AND human` external commitments.

## Decision

### D1 — One agent task is one run

`tasks` remains the single durable work table; no parallel `agent_runs` table is introduced. For `execution_mode = agent`, one task row represents exactly one execution occurrence and stores at most one authoritative eve `session_id`. The dispatcher intends one run, but the accepted-before-binding ambiguity in D3 means the database cannot prove that eve never briefly accepted an unrecorded session.

For agent tasks, `tasks.status` is:

```text
queued | running | succeeded | failed | cancelled
```

A future row remains `queued`; `due_at` determines whether the UI renders it as `scheduled` or ready. `succeeded`, `failed`, and `cancelled` are terminal and require `finished_at`. `queued` and `running` require `finished_at IS NULL`.

The original active-work constraint becomes the broader shared-table index after ADR-019:

```sql
UNIQUE (kind, brand_id, subject_key)
WHERE status IN ('awaiting_approval', 'queued', 'running')
```

It still deduplicates scheduled and active equivalent ordinary work. Human commitments use a proposal-specific subject identity, so independently intended proposals do not coalesce. A terminal failure releases the logical identity. The task stores the stable key and canonical creation hash of the request or occurrence that created it, so replay of that creator returns the same row, reuse of the key with different input fails, and a genuine retry uses a new key.

V1 does not persist aliases for later requests that merely observe or reschedule somebody else's active row. Such a caller receives the existing task id, but its distinct request key is not bound durably. A retry while that task remains active observes it again; a retry after it becomes terminal may create a new task. This narrow loss-of-response window is accepted instead of adding a `task_request_keys` ledger.

### D2 — Claim for delivery and start in task mode

An agent root may claim a row only when all of these hold:

- `status = 'queued'`;
- `due_at <= now()`;
- `execution_mode = 'agent'`;
- `session_id IS NULL`;
- `worker_key = SELF`;
- `kind IN compiledSupportedKinds`;
- the brand pool has autonomous AI credit available under ADR-011 D4.

The balance check is agent-specific and happens before this claim; it is not part of a generic task predicate shared with direct lanes. At zero balance the row remains `queued`, consumes no drain execution slot, and no eve session starts. Under ADR-019's amended drain order, agent rows receive only the batch capacity left after human commitments and retry-safe direct/automatic work. Eligible due agent rows are FIFO by `created_at, id`; `due_at <= now()` is a filter, not the FIFO key.

`/internal/dispatch` is a route of the root's custom machine channel. It authenticates the raw `Authorization: Bearer $DISPATCH_SECRET` poke, returns `202`, and registers the bounded drain with the route's `waitUntil`; the request carries no task, tenant, payload, worker, or target selector. The atomic claim inside that drain changes `queued → running` and records `started_at`. It does not increment `attempts` or install an execution lease. The root then reloads the authoritative task and graph context and starts the run through Eve 0.31.3's channel-address API:

```ts
const session = await from(`task:${taskId}`).send(brief, {
  auth,
  mode: "task",
  outputSchema,
});
```

`task:<task_id>` is the raw channel-local correlation and single-owner address for this one run; Eve adds the machine-channel namespace. It is not a Branderize identifier and is never used for a later conversational turn. The returned `session.id` is stored once as the task's authoritative `session_id`; it is not the "latest" member of a sequence.

Every task therefore starts with fresh eve history, state, and session-scoped sandbox. The root receives continuity only through the current task, referenced artifacts, and work-graph projections loaded from Postgres.

### D3 — Recover only an unproven delivery

Like the current CRM, a `session.started` hook immediately attempts to bind `ctx.session.id` to the task using trusted task context; the post-`from().send()` update uses the returned `session.id` as a second path for the same fill-once write. This materially narrows the gap between eve accepting delivery and Postgres knowing its id.

The dispatcher may move an agent task from `running` back to `queued` only when `session_id IS NULL` and `started_at` is older than the five-minute delivery window. In the same transition it clears `started_at`, staged completion metadata, and `next_*` before another claim. This recovers a process death between the database claim and persistence of eve's accepted session without letting a later delivery inherit state staged by the unbound one.

Once `session_id` exists, that task is never dispatched again. A known `send()` rejection, `turn.failed`, `session.failed`, or cancellation produces a terminal `failed` or `cancelled` task. A run with a `session_id` but no projected terminal event remains `running` for investigation; the dispatcher must not guess that starting another LLM run is safe.

The terminal event may race persistence of the returned `session_id`. Event handlers therefore correlate the task from trusted channel context, not by searching for an id that may not be stored yet. The `session.started` hook may only fill a null id on the current `running` task. The post-`send()` path normally does the same; as a cheap auditability improvement over the CRM's guarded update, it may also fill the id on the already-terminal same task. Neither path may attach to `queued`, reopen the task, or rewrite its outcome.

There is still an unavoidable narrow ambiguity if eve accepts a session but both binding paths fail. Reusing the same channel-local address makes a recovery delivery resolve to the existing owner while it is alive; if that unrecorded session already released the address, recovery can start another physical session. Branderize therefore guarantees one authoritative bound `session_id` and no redispatch after that binding, not exactly one physical acceptance. Idempotent tools and first-terminal-writer-wins settlement bound the ambiguity without adding another coordination protocol in v1.

This separates a known delivery rejection from failure to persist an already accepted handoff. The current CRM wraps `send()` and its post-send `sessionId` write in one `try` and labels an exception from either operation `DELIVERY_FAILED`; Branderize instead treats a post-acceptance binding failure as the recoverable ambiguity above because the eve run may already be executing. The `session.started` hook is the primary binding path in both systems.

V1 deliberately copies the CRM's lack of a handoff-generation fence. After a sessionless recovery and new claim, an exceptionally late hook, return, or terminal callback from the previous delivery is distinguished only by the task's current status and fill-once fields, not by a `handoff_id`. It can therefore win the authoritative binding or first-terminal-writer race. The five-minute window, immediate `session.started` binding, stable address, idempotent effects, and absence of redispatch after binding make this a narrow accepted failure mode. A future generation fence must be end-to-end across dispatch, trusted eve context, hooks, tools, and terminal handlers; a partial fence is not a v1 improvement.

`attempts`, `MAX_ATTEMPTS`, agent execution leases, reclaim after session acceptance, and `retireExhausted` do not apply to `execution_mode = agent`.

### D4 — Stage `TaskCompletion`; settle on `session.completed`

Every durable root exposes an authored deterministic `finishTask` tool. Trusted eve session context supplies `task_id`; the model cannot select another task. The tool:

1. locks the current `running` task;
2. validates the payload against that kind's registered `TaskCompletion`;
3. validates the referenced outputs under the task's brand and output contract;
4. stages the validated completion on the task without making it terminal.

The root then returns the same schema through its configured output contract. Eve may emit `result.completed` for that structured return, but that event is observability rather than the database settlement boundary: the value staged by `finishTask` is canonical, and a mismatching returned value is recorded for diagnosis but cannot replace it.

The machine channel settles on terminal lifecycle events:

- `session.completed` plus a valid staged completion changes `running → succeeded`;
- `session.completed` without a valid staged completion changes `running → failed` with `MISSING_TASK_COMPLETION`;
- `turn.failed` or `session.failed` changes `running → failed`;
- cancellation changes `running → cancelled`.

Runtime/session settlement transitions are idempotent and guarded by `status = 'running'`; the first terminal writer wins. For **agent rows**, administrative cancellation may instead change either `queued` or `running` to `cancelled`. This is not a shared direct-task rule: ADR-019 permits direct/human cancellation only from `awaiting_approval` or `queued`, atomically with its Cancellation Action, and never after `running`. `completed`, `partial`, and `blocked` remain deliberate domain outcomes inside the staged `TaskCompletion`, and all three produce execution status `succeeded`. A technical failure is never synthesized into `blocked`.

This is one deliberate fail-closed adaptation of the current CRM runner. CRM permits `session.completed` to fall back to a generic summary when `finish_run` did not stage one. Branderize cannot do that because the typed completion carries the Object and follow-up references used by its work graph; accepting a fallback would publish an unverifiable result.

Cancellation is an application policy layered on eve's lifecycle. If an accepted turn is cancelled, `turn.cancelled` changes the application task to `cancelled`; eve 0.31.3 then emits its normal `session.waiting`, which is expected in this one case but is ignored and its address is never reused. A task-bound canonical database mutation includes `status = 'running'` in the transaction that commits it. A registered create-only provider-draft operation follows its trusted replay contract: stable key, deterministic lookup, or accepted duplicate-safe at-least-once creation. External commitment execution is outside this session and follows ADR-019. Other `session.waiting` events remain anomalous telemetry and never succeed, requeue, or continue the task.

Eve awaits channel event handlers but logs and absorbs their exceptions. Consequently the transitions above describe the healthy projection path, not an exactly-once guarantee: a persisted terminal stream event whose database projection failed can leave the task `running`. That state raises an alert and is reconciled manually from the durable stream and staged result; it is never repaired by starting another agent run.

### D5 — Only successful completion materializes an agent-chosen recheck

The constrained `scheduleRecheck` protocol remains. A running recheck may stage one `next_due_at`, `next_payload`, and `next_rationale` tuple on itself through the existing trusted, deterministic tool.

The same transaction that changes the current task to `succeeded` may materialize the staged successor with a stable idempotency key derived from the completed source task, then clear `next_*`. The insert uses conflict-safe create-or-observe semantics: if an equivalent active booking won concurrently, settlement observes that booking rather than rolling back the current task's success. The postcondition is exactly one equivalent active booking, not necessarily a newly inserted row. A `failed` or `cancelled` transition clears `next_*` and creates no successor. This preserves the existing product rule that an agent-authored cadence continues only after the root deliberately completes its current work.

Branderize does not copy the CRM's separate immutable schedule-trigger table. CRM schedules are fixed application configuration; Branderize rechecks are bounded decisions made through a tool during the run.

### D6 — Only retry-safe direct/automatic work retains bounded retry

`execution_mode = direct AND activation = automatic` may continue to use its two-minute lease, `attempts`, three-claim ceiling, reclaim, and exhaustion behavior only for registered retry-safe deterministic handlers. Those handlers are limited to transaction-safe internal operations or side-effect-free idempotent external reads; this lane never performs an external write. Within the remaining bounded drain capacity after human commitments, its eligible due rows are FIFO by `created_at, id` and precede agent rows. ADR-019 resolves the separate case: `direct AND human` external commitments use no lease, attempts, reclaim, or `MAX_ATTEMPTS`.

The explicit status mirrors that existing lifecycle without changing its mechanics:

- the first claim changes `queued → running` and increments `attempts`;
- a failed handler leaves the unfinished row `running`; after lease expiry it is reclaimable below the limit;
- a reclaim renews the lease and increments `attempts` while status remains `running`;
- successful deterministic completion changes `running → succeeded`;
- exhaustion retirement changes `running → failed` and clears `next_*`. For a provider Verification poll, the retirement transaction also appends the terminal provider-outcome Verification Action `unverified(technical_exhaustion)` required by ADR-019.

Only retry-safe direct/automatic rows consult `MAX_ATTEMPTS` or use `leased_until`. Generic claim and retirement helpers must branch on both `execution_mode` and `activation` before reading either field.

### D7 — Database checks hold the shared-table state machine

For agent and direct/automatic rows, the migration encodes these invariants; ADR-019 adds the direct/human checks below them:

- `status IN ('succeeded', 'failed', 'cancelled')` if and only if `finished_at IS NOT NULL`;
- `status = 'running'` requires `started_at IS NOT NULL`;
- `status = 'queued'` requires `started_at IS NULL`, and a queued agent row also requires `session_id IS NULL`;
- agent rows require `attempts = 0` and `leased_until IS NULL`;
- direct rows require `session_id IS NULL` and no staged `TaskCompletion`; only direct/automatic rows may have lease/attempt state;
- every terminal row has `leased_until IS NULL`;
- staged completion metadata is non-null only for a running agent row and is copied to terminal outcome fields before being cleared;
- `next_due_at`, `next_payload`, and `next_rationale` are either all null or all non-null, and a non-null tuple requires `status = 'running'`.

ADR-019 additionally requires `agent -> activation = automatic`, rejects `agent/human`, and requires direct/human rows to have zero attempts, no lease/session/stage/`next_*`, mandatory revision/payload hash, and an Approval Action from `queued` onward. Every recovery and terminal transition clears the lane-specific transient fields that must not survive it. Cancellation is lane-specific: agent cancellation follows D5, while direct/human cancellation follows ADR-019 and cannot target `running`. These checks keep one shared table implementable without adding a parallel run table.

## Consequences

- An authoritatively bound agent run is never replaced because an application lease expired; agent rows have no execution lease. Only the unbound handoff ambiguity in D3 can produce more than one physical acceptance for the same row.
- Agent failures become visible terminal records instead of silently consuming another inference run.
- A retry is auditable as a new task with a new task id and creator idempotency key.
- Eve owns durability inside the accepted run; Postgres owns enqueue idempotency, domain state, and the handoff record.
- `finishTask` records domain completion before `session.completed` publishes the terminal task transition, so final usage and events precede the application success boundary.
- Human CMO conversations continue to persist their Eve-generated fixed `session_id` and `stream_index` cursor on the owning conversation under ADR-016; this ADR changes no human-chat behavior.
- Direct deterministic work has two registry-selected lifecycles in the same table: bounded retry only for retry-safe automatic kinds, and ADR-019's one-shot human/external commitments. Automatic handlers may mutate only local state transactionally or perform side-effect-free idempotent external reads; they never write externally. Tests and helpers must branch on both mode and activation.
- Branderize does not add an immutable agent-version table in v1. Its roots are internal product code, and `compiledSupportedKinds` remains the deploy-skew boundary. This is an explicit, low-cost divergence from the CRM's user-deployed version model.

## Contract tests

The implementation is invalid if any of these are possible:

- an agent task calls eve without `mode: "task"`;
- `/internal/dispatch` is not a `DISPATCH_SECRET`-authenticated custom-machine-channel route using `waitUntil`, accepts a task or tenant selector, or starts a claimed row through anything other than ``from(`task:${taskId}`).send(brief, { auth, mode: "task", outputSchema })`` with the returned `session.id` as the authoritative binding;
- an agent task can be claimed at zero autonomous-credit balance, or the agent-specific balance gate can block either direct lane;
- one agent task stores more than one authoritative `session_id`, or any path promises that no unrecorded physical session can exist inside the accepted handoff ambiguity;
- the root lacks the current-CRM-style `session.started` binding hook or delivery recovery preserves staged completion or `next_*`;
- an early terminal event cannot settle by trusted task context before `session_id` is stored, or the later session-id attachment reopens or rewrites that terminal task;
- an agent task with a `session_id` returns to `queued` or is reclaimed;
- agent claim, failure, or settlement reads or increments `attempts`;
- a stale agent task with `session_id IS NULL` cannot recover delivery, or a task with a session can;
- `finishTask` can target a task other than the one in trusted session context;
- `result.completed` alone or `session.completed` without staged valid completion produces `succeeded`;
- a mismatching `result.completed` value replaces the canonical staged completion, or an unmaterialized self-recheck is reported as an existing `follow_up_task_id`;
- `turn.failed`, `session.failed`, or application cancellation leaves an agent task eligible for redispatch; a canonical database mutation can commit after the task is no longer `running`; or a create-only provider draft runs without its registered idempotent, recoverable, or duplicate-safe replay contract;
- a failed or cancelled agent task materializes staged `next_*`;
- replaying the creator/occurrence `idempotency_key` creates a second task, reuse of that key with a different canonical request hash is accepted, or a genuine retry reuses the failed task id;
- successor insertion can roll back an otherwise valid success merely because an equivalent active booking won concurrently;
- a row can violate any D7 database check;
- a generic direct-task retry helper can reclaim an agent row or a human external commitment;
- a retry-safe direct/automatic task loses its separately accepted bounded behavior, performs an external write, or a human commitment acquires that behavior despite ADR-019;
- a provider Verification poll exhausts its retries without atomically failing the poll task and recording `unverified(technical_exhaustion)` with no successor.
- the bounded drain uses anything other than FIFO `created_at, id` within eligible automatic-direct or agent rows, counts a zero-credit agent candidate as a successful claim, or treats its per-invocation batch as a global concurrency cap.

## Alternatives considered

- **Keep conversation mode and three claims** — rejected: it conflates an application retry with continuation of an accepted durable run, permits overlapping inference after lease expiry, and no longer follows the relevant CRM execution model.
- **Three fresh task-mode sessions on the same task row** — rejected: this is neither the CRM one-shot unit nor a clean audit model; one row would have multiple session identities and competing terminal results.
- **Create a separate `agent_runs` table** — rejected for v1: the existing task already is the durable execution occurrence, so another layer would duplicate identity without buying a required capability.
- **Add a per-claim `handoff_id` fence** — deferred: it would close the accepted late-callback race only if every dispatch update, trusted eve callback, task-bound tool, and terminal handler compares the same generation. The current CRM runs without it, and v1 copies its narrower hook-plus-timeout discipline instead of introducing a partially enforced protocol.
- **Persist every coalesced request key in a `task_request_keys` ledger** — not adopted in v1: active-work dedup still returns the existing task, but exact replay after that task becomes terminal is guaranteed only for the request that created it. The accepted failure window requires a lost response followed by settlement before the caller retries.
- **Apply one retry policy to every direct kind** — rejected by ADR-019: the CRM's local transactional `AgentAction` safety does not generalize to provider writes. Internal transaction-safe work may retry; human external commitments make one automatic call and stop on ambiguity.
