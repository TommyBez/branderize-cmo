# ADR-017 — Consultative subagents; durable specialist work enters through tasks

**Status:** Accepted — 2026-08-06
**Amends:** ADR-006 (scope of the interactive declaration), ADR-007 (interactive specialist approvals and durable task entry), ADR-011 D1 (delegation guard), ADR-012 D1/D2 (parked specialist approvals and return contracts), ADR-013 D2/D3 (lateral enqueue and consultative sandbox), ADR-015 D1–D6 (mode composition, self-copies, tools, task kinds, and capability gating)
**Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) — agent work is one task-mode run with terminal failure; bounded lease reclaim remains direct-lane only
**Amended by:** [ADR-019](019-human-approved-external-commitments.md) — direct mode splits into transaction-safe automatic work and one-shot human external commitments; executable proposals are tasks
**Refs:** ADR-008 (mechanical write-path enforcement), ADR-009 (standalone roots and dispatch fan-out), ADR-014 (task dedup index), ADR-016 (eve session-state adapter), ADR-018 (one-shot durable runs), eve 0.31.3 bundled docs (`subagents.mdx`, `channels/custom.mdx`, `guides/dynamic-capabilities.md`, `guides/hooks.md`, `guides/session-context.md`, `patterns/dynamic-scheduling.md`, public `ToolContext` and channel-operation types)

## Context

ADR-006 declared every specialist twice: as an eve declared subagent for in-process CMO delegation and as a named root agent for queue dispatch. ADR-011 then required both activation doors to deduplicate against in-flight work before starting another specialist session.

That guard is not implementable as a hard invariant around a local declared subagent with eve 0.31.3's public API:

- eve lowers each declared subagent into a framework-owned model-visible tool;
- an authored tool cannot shadow that tool because name collisions are rejected;
- authored `ToolContext` exposes no public operation for invoking a declared subagent after application code acquires a database claim;
- hooks observe events after they are durably recorded and cannot intercept a subagent call;
- dynamic subagent availability is resolved at session or turn scope and rechecked before child start, but it is not an atomic claim over the call's task identity.

A prompt sequence such as "check the tasks table, then call the specialist" would therefore be both model-optional and racy. The lane-specific queue claim does not close the gap for a direct child session: that session has no task row on which Postgres can enforce either the agent status transition or the direct lease.

The product still benefits from fast specialist consultation inside the CMO conversation. We accept that a read-only consultation can occasionally duplicate inference spend; we do not accept hidden canonical writes, follow-ups, commitment tasks, or external effects from that lane.

The original queue lifecycle in this ADR came from a CRM path that is no longer the relevant precedent for autonomous agent execution. ADR-018 replaces that portion only. The current CRM `AgentRun` has explicit terminal status, a unique `sessionId` and idempotency key, one `mode: "task"` session, and recovery only while a claimed run is still missing its accepted session id. Once the session exists, a failure is terminal and a later retry or schedule occurrence is a new run.

Branderize keeps three adaptations required by its product: enqueue deduplication is a partial unique index over active task status; a creator/occurrence `idempotency_key` deduplicates replay of the insertion that won; and an equivalent self-recheck is staged on the running task before successful completion creates or observes one active successor. V1 deliberately stores no aliases for other requests coalesced onto that row. The consultative subagent also remains mechanically read-only because Branderize has multiple specialist activation surfaces.

We retain the separation between immediate work and recurring `recheck` work: they have distinct task kinds even when they resolve to the same root specialist and execution logic. Without that distinction, an active booking due weeks from now would make an immediate request for the same subject return `already_active` and wait until the future date.

## Decisions

### D1 — The two declarations have different authority

The shared registry still materializes every specialist in two forms, but they are no longer equivalent activation doors:

1. **Consultative declared subagent** — in-process, session-bound advice to the CMO. It can read context and return analysis, but cannot create durable work or perform boundary actions.
2. **Standalone durable root agent** — task-bound execution started by that root's dispatcher. Each specialist root is its own eve app/deployment (ADR-009), and explicitly configures its standard `eveChannel` with `auth: [localDev()]`: the session and info routes reject production traffic while health remains public. Its agent lane owns one-shot specialist production, budget enforcement, graph writes, and registered create-only provider-draft preparation. Its direct lane owns retry-safe deterministic automatic handlers and post-approval external commitments; those handlers do not run inside eve. Automatic handlers may mutate local state transactionally or perform side-effect-free idempotent external reads, but never external writes. Human and console writes continue to use the brain path without impersonating a specialist.

They continue to share specialist identity, core instructions, skills, model defaults, and `actorKey`. Their mode addenda, input/return contract, executable tool surfaces, connection allowlists, and sandbox/egress policies differ mechanically. `packages/agents` generates the consultative form inside `agent-cmo` and the durable wrapper inside the specialist's standalone app from that one shared entry.

### D2 — Consultation is read-only by construction

The generated declared-subagent manifest receives a `consultTools` surface containing only:

- brand and graph reads;
- read-only research tools and connection methods;
- helpers that transform data without persisting it.

It physically excludes:

- `produce_object`, `propose_decision`, `record_evidence`, and every other graph mutation;
- `schedule_recheck`, task creation, and follow-up scheduling;
- commitment preparation/approval/execution and every connection method with an external effect.

Declared subagents inherit no authored parent slots, but eve can still supply framework-default tools. Their generated definition therefore disables networked/effectful defaults explicitly: the consultation sandbox may hold disposable scratch files, but uses `deny-all` egress. External research is exposed only through authored or connection operations whose read-only behavior is allowlisted and validated in code.

The subagent definition configures a token-capped `ConsultationReturn` as its default task-mode result, and the CMO requests the same shape when delegating:

```text
{ summary, recommendations[], source_refs[], suggested_work[], open_questions[] }
```

eve's native subagent tool permits the caller to provide an `outputSchema`, so the fixed shape is not an authorization boundary by itself. Any consultation reused as durable input is validated again by application code. Safety comes from the missing mutation and effect tools, not from trusting the returned shape.

The configured contract contains no `produced_object_ids` or claimed `follow_up_tasks`, because the subagent has no capability to create either. `suggested_work` is advice to the CMO, not evidence that a task was enqueued. The result is conversation material, not a canonical Object. Tool descriptions and instructions teach the CMO when consultation is appropriate; the restricted manifest ensures that misrouting cannot turn into a durable side effect.

Direct consultations do not create task rows and are not deduplicated. Their child sessions remain metered and observable through normal eve telemetry. Duplicate consultation spend is an explicit accepted limitation, not a property the task lease claims to prevent.

### D3 — Every durable specialist execution starts from one active task

No named specialist root may be activated without a task row. Any immediate CMO request that may create or supersede an Object or Decision, record evidence, prepare an external draft, or create a human commitment enters through a typed task path. Autonomous producers of agent work — including Decisions and typed lateral edges — use `enqueueOrObserveTask`; preparing a human commitment creates a distinct direct row in `awaiting_approval` through ADR-019's constrained service. Future agent follow-ups and recurring bookings use `scheduleRecheck`.

The shared `enqueueOrObserveTask` service resolves `brand_id` from trusted application context, validates the registered `kind` and typed payload, resolves the specialist, and derives `subject_key` through the task-kind registry. Neither `brand_id` nor `subject_key` is a model-authored argument. The service then atomically enqueues or observes the active task:

```text
request_specialist_work({ kind, payload })
  -> accepted       { task_id, task_state: scheduled | queued }
  -> already_active { task_id, task_state: scheduled | queued | running }
```

An immediate kind and its future-recheck kind are separate queue identities. Every immediate kind that permits a follow-up declares one deterministic `recheckKind` in the registry. That target is a registered kind owned by the same durable root; both kinds may share a brief schema, output contract, core brief builder, and execution handler. The recheck kind may point its own `recheckKind` relation back to itself for recurring work. Names such as `seo-audit` and `seo-audit-recheck` are illustrative, not a naming convention.

`scheduleRecheck` is an authored, constrained tool available only to durable roots. The agent judges when and why it should return and supplies only bounded, registry-validated scheduling input: the typed recheck payload, `due_at`, and human-visible rationale. It does not choose an arbitrary task kind. The current `task_id` comes from trusted eve session auth/context established by the authenticated machine channel; application code reloads the current row, resolves its sole authorized `recheckKind`, verifies that the target belongs to the same root, validates the target kind's payload, and derives `brand_id`, `subject_key`, and `worker_key` through the task row and registry. The model never supplies any of those identities or the target `kind`.

For ordinary future work, the tool calls `scheduleOrRescheduleTask`: it inserts a new booking or moves an already-scheduled equivalent booking's `due_at`, rationale, and scheduling template. The first follow-up from an immediate task has a different kind and therefore a different queue identity from the running task; it can be booked without changing or conflicting with that immediate row.

An equivalent self-recheck occurs when a running recheck schedules the same registered recheck kind and subject again. The partial unique index prevents a second active row, while moving the running row's own `due_at` would cause its next execution to disappear as soon as that row completes. The deterministic tool implementation therefore leaves the current `due_at` and accepted payload unchanged and updates the running task's single pending-successor slot instead:

```text
next_due_at
next_payload
next_rationale
```

Repeated valid self-recheck calls replace that pending booking; they do not create additional successors. The model chooses the bounded schedule data, but trusted code chooses the row and applies the database transition.

The self-recheck write is one conditional statement against the current task, not a read followed by a general source-task lock:

```sql
UPDATE tasks
SET next_due_at = :due_at,
    next_payload = :payload,
    next_rationale = :rationale
WHERE id = :current_task_id
  AND status = 'running'
RETURNING id;
```

The application supplies `current_task_id` from trusted session context. If `RETURNING` yields no row, `scheduleRecheck` returns `task_closed` and performs no fallback insert or reschedule. Every terminal transition updates that same physical row, so Postgres row-update serialization settles the race without a separate `SELECT ... FOR UPDATE`: if scheduling commits first, successful agent completion materializes the staged tuple while agent failure/cancellation or direct/automatic exhaustion clears it; if settlement commits first, the conditional scheduling update affects zero rows. Human commitments never use this successor slot. This narrow self-target guard is a single conditional statement and does not itself require an interactive transaction; it still runs through the canonical Drizzle/`pg` adapter selected by ADR-005.

This is not a general liveness fence on the task that asks for other future work. A follow-up from an immediate kind targets a distinct recheck row, and scheduling from another authorized task retains the accepted last-write-wins scheduling semantics. The conditional guard exists for the self-recheck only because its trusted source task and target booking are the same row.

There is exactly one future booking per queue identity even when multiple authorized tasks owned by the same root independently schedule it. If the target row is still scheduled, every valid `scheduleOrRescheduleTask` call atomically replaces that row's `due_at`, typed payload, and rationale. If the equivalent target is running, every valid call atomically replaces its single `next_due_at`, `next_payload`, and `next_rationale` tuple. Postgres row-update serialization arbitrates concurrent callers: the last valid database write wins. "Last" means the update that wins database ordering, not the agent that started first or whose wall-clock request arrived last. There is no earliest-date priority, preference for an immediate source task, field merge, or second successor.

Postgres arbitrates concurrency with the partial unique index:

```text
(kind, brand_id, subject_key) WHERE status IN ('awaiting_approval', 'queued', 'running')
```

ADR-018's `queued | running | succeeded | failed | cancelled` lifecycle remains complete for agent tasks. ADR-019 adds `awaiting_approval`, `outcome_unknown`, `expired`, `needs_regeneration`, `dismissed`, and `superseded` for direct/human commitments. Only retry-safe direct/automatic rows may additionally be rendered as reclaimable or awaiting retirement from `leased_until` and `attempts`. The task stores one stable creator/occurrence `idempotency_key UNIQUE` plus its canonical creation hash; v1 still stores no alias for a distinct request that only observed or rescheduled another active row.

Enqueue first resolves the supplied creator key and validates its canonical request hash. If that key exists, replay returns its historical task even when another equivalent task is currently active. Otherwise, if insertion wins, the caller pokes the dispatcher and returns `accepted`. If the active-key constraint wins, `enqueueOrObserveTask` returns the existing row as `already_active` without modifying its `due_at`, typed payload, or human-visible rationale and without persisting the caller's distinct request key. A genuinely new request uses a new key. Before inserting direct/automatic work, the same transaction may retire a matching expired exhausted retry-safe row. A human commitment instead receives a proposal-specific subject identity and remains `awaiting_approval` until the exact human transition; it is never retired or reclaimed by the generic direct helper.

Dedup ensures one active logical work item for ordinary task identities. The execution guard then depends on both mode and activation: agent/automatic uses ADR-018's one-shot eve handoff; direct/automatic may use `FOR UPDATE SKIP LOCKED` plus a bounded lease; direct/human follows ADR-019's approval receipt and one-shot provider call.

For `execution_mode = agent`, the root first applies the agent-specific autonomous-credit gate. With balance available, claim selects a due `queued` row with `session_id IS NULL` only where `worker_key = SELF AND kind IN compiledSupportedKinds`, then atomically changes it to `running` and records `started_at`; at zero balance it leaves the row untouched. It does not read or increment `attempts` and installs no execution lease. After the claim, the machine channel reloads the authoritative brief and calls ``from(`task:${taskId}`).send(brief, { auth, mode: "task", outputSchema })``; the raw address is channel-local and eve adds the channel namespace. A CRM-style `session.started` hook binds `ctx.session.id`, while the post-send path binds the returned `session.id`; those paths race to fill the single authoritative id. Only a `running` row still missing it after five minutes may be reset to `queued`, atomically clearing `started_at`, staged completion, and `next_*`. Once the id is stored, that task is never redispatched. If both binding paths missed an accepted session, recovery can physically start another only after the unrecorded owner has released the shared address; the guarantee is one authoritative binding, not proof of one physical acceptance.

For `execution_mode = direct AND activation = automatic`, the existing bounded retry protocol remains: select a due unleased-or-expired row below `MAX_ATTEMPTS`, claim with `FOR UPDATE SKIP LOCKED`, and increment attempts. The registered handler must be retry-safe: either a transaction-safe internal operation or a side-effect-free idempotent external read, never an external write. For `direct AND human`, only `approveTask` may create `queued`; registry-declared serialized kinds first acquire their trusted target slot in that approval transaction. The responsible root completes deterministic preflight, re-derives any persisted conflict key from the final registered payload, then claim atomically checks its Approval Action and changes it to `running`, with no lease or attempts. Neither direct path consults the agent credit balance. The human claim is the point of no return: it makes at most one provider call and never returns to `queued`. Generic helpers must branch on mode and activation before reading balance or lease/attempt fields. Unsupported kinds remain untouched; an obsolete human commitment is explicitly moved to `needs_regeneration` before handler support is removed.

Only dispatcher code inside the custom machine channel starts a specialist root in production. Every task's registered kind supplies worker, mode, activation, and execution contract; a root may claim only `worker_key = SELF AND kind IN compiledSupportedKinds`. Agent mode attempts one eve run through the channel-local address with `mode: "task"`; `session.id` is its authoritative runtime identity. Direct mode executes the fixed plain-code handler inside the same responsible deployment. For a human commitment, preflight and the claim transaction reload and validate the final revision and durable Approval Action before the row becomes `running`; they do not re-evaluate the approver's later membership or role. After that point the fixed handler consumes the claimed immutable payload and does not reinterpret or reauthorize it. Neither the model nor an HTTP caller supplies a replacement brief or connector method. Public/user routes cannot invoke a root directly, and an eve callback never becomes a second commitment executor.

Dispatch wakeup is centralized but execution is not. One Vercel Cron route in `apps/app` verifies `CRON_SECRET` without forwarding it, then uses `DISPATCH_SECRET` and `Promise.allSettled` to send seven parallel `POST /internal/dispatch` pokes with independent two-second timeouts. `/internal/dispatch` is authored as a route of each root's custom machine channel. It carries no task, brand, payload, worker, or target selector: the CMO and six specialist roots authenticate only the raw Bearer poke, return `202`, and register their own drain through the route's `waitUntil`, claiming exclusively through their compiled root-and-kind allowlists. There are no eve schedules. A process-local `collapsing()` guard is best effort; atomic agent claims, bounded direct/automatic leases, and one-shot human-commitment claims arbitrate overlapping pokes across instances. On every tick, each healthy root first terminalizes only its own stale human commitments as `outcome_unknown`, then fills one bounded batch in deterministic lane order: claimable human commitments by deadline and Approval time, remaining capacity with retry-safe direct/automatic work FIFO, then agent FIFO. This is query order, not stored priority or preemption (ADR-009, ADR-019).

For `execution_mode = agent`, `finishTask` obtains `task_id` from trusted session context, validates that kind's `TaskCompletion` and referenced outputs, and stages the canonical value without changing status. `result.completed` may mirror the return for telemetry but cannot replace the staged value. Only `session.completed` with that value normally changes `running → succeeded`; completion without it becomes `failed` with `MISSING_TASK_COMPLETION`. `completed`, `partial`, and `blocked` are all valid domain outcomes under `succeeded`. Delivery error, `turn.failed`, `session.failed`, and application cancellation are terminal `failed` or `cancelled` transitions. Eve follows `turn.cancelled` with `session.waiting`; Branderize ignores that boundary and never reuses the address. Other waiting remains anomalous. A failed terminal projection leaves the task running for alert and manual stream-based reconciliation, never redispatch.

For `direct/automatic`, no eve event exists: a registered retry-safe deterministic handler may settle success or remain under its bounded retry policy. A provider-outcome Verification poll is one such handler: it reloads the accepted Result Action, performs a side-effect-free idempotent provider read, and records a typed Verification Action without eve, an LLM, or agent credits. `pending`, `completed`, provider-domain `failed`, and provider-domain `unverified` settle the current poll as technically `succeeded`; only `pending` creates or observes one same-root successor atomically after releasing the current active identity. Deadline and technical exhaustion record `unverified` with distinct reason codes, and only technical exhaustion marks the poll task `failed`. For `direct/human`, the provider-specific fixed handler must return ADR-019's closed `CommitmentOutcome`: `accepted` with a schema-valid stable receipt settles `succeeded`, `rejected` is permitted only with proof of non-application and settles `failed`, and `unknown` settles `outcome_unknown`; every result is terminal. The generic dispatcher only exhaustively switches over that union. It never interprets HTTP statuses or SDK exceptions, and any unexpected throw after claim becomes `outcome_unknown`, never `failed`. Appending its Result Action, linking `result_action_id`, and the compare-and-swap from `status = 'running'` are one Postgres transaction, so a lost terminal race rolls back the Action too. A billable `succeeded` inserts its sole `action_charge` in that transaction from the approval's pricing snapshot; if its kind declares eventual verification, the same transaction creates or observes the first poll task. No other result is charged. Human commitments never carry `next_*`. Explicit administrative cancellation appends its own Action and may win only from `awaiting_approval` or `queued`; removing or degrading the approver is not an implicit cancellation. Once the claim has changed a row to `running`, the only application outcomes are `succeeded`, `failed`, or `outcome_unknown`; neither administrative cancellation nor a deadline can revoke or reclassify a provider request that may already be in flight.

`retireExhausted` is direct/automatic-only. It cannot select a human-activation row. Agent failures are already terminal, and retrying agent work is a new task. Retrying an external commitment after `failed` or `outcome_unknown` also creates a new task, but only through another human approval.

An authoritatively bound agent task has no execution lease or reclaim path. Eve may replay an interrupted step inside that run, and a retry-safe direct/automatic handler may overlap after lease expiry only when its registered semantics make that acceptable. A human external commitment has neither mechanism: after its claim there is no automatic provider re-call. Before each drain, its responsible root closes still-`running` rows older than ADR-019's `STALE_AFTER` as `outcome_unknown`; the configured provider HTTP timeout is shorter than the root Function lifetime, which is itself shorter than that stale horizon. Provider idempotency keys remain useful where supported, but an unknown outcome still stops for a human because no database transition makes the API call transactional.

The ordinary-work dedup identity is never `(specialist, brand_id)` alone. Every registered task kind defines a deterministic `subjectKey(payload)`, producing `(kind, brand_id, subject_key)`. Immediate and recheck kinds may derive the same subject but remain distinct by kind. Human commitment proposals are the deliberate exception to semantic coalescing: each independent proposal uses a stable identity such as `commitment:<task_id>`, while creator-key replay still returns the same row. A separate trusted `commitment_conflict_key` may exclude simultaneous `queued | running` inverse commands without coalescing their proposal identities, ordering them, or acting as a caller-supplied nonce.

The queue does not carry a separate contract version in v1. A published kind changes only backward-compatibly. Breaking payload, preview, ownership, policy, handler, or execution semantics use a new kind. Agent and direct/automatic rows may drain under expand-contract. Human commitments that can no longer execute safely are moved to `needs_regeneration` before the old handler is removed; they are never reinterpreted by a new generic executor.

The active-key constraint promises one equivalent active task row, while the task's creator key protects replay of the creation that won. V1 intentionally does not promise exact replay for distinct requests coalesced onto that row. Completed work may be requested again under a new creator key; eve step replay and direct lease expiry still require conflict-aware brain writes and idempotent boundary tools.

### D4 — Promoting consultation to durable work creates a task

If a human later asks to save, develop, schedule, or act on a consultation result, the CMO calls `request_specialist_work`. The typed payload may include a bounded `consultation_context`: selected recommendation keys, a size-capped snapshot, and origin session/message/turn references added or verified by application code. This is conversational brief context, not an artifact and not canonical evidence. Artifact-sized content still travels by Object id. The service validates every reference, selected value, snapshot limit, and task payload; a previous model result is input, never trusted proof.

The root specialist may reuse the consultation rather than repeat its research, but it remains responsible for validating the durable output contract and performing the canonical write. Promotion never lets the CMO write under a specialist's identity and never grants write tools back to the declared subagent.

If the user requests durable work from the outset, the CMO skips consultation and enqueues it directly.

### D5 — Registry generation and tests hold the boundary

The registry exposes separate mode composition from one specialist definition:

```text
shared:       actorKey, instructions, skills, modelDefaults
consultation: routingDescription, ConsultationReturn, consultTools,
              read-only connections, deny-all sandbox egress
durable:      taskKinds, TaskCompletion, workTools,
              policy-gated connections, specialist sandbox policy
```

Materialization tests fail when:

- a declared specialist receives a graph mutation, task mutation, external draft, or effectful connection tool;
- a declared specialist receives a framework-default tool or sandbox policy capable of unbrokered external effects;
- a commitment's verification relation targets another root, a kind absent from that root's `compiledSupportedKinds`, a non-`direct/automatic` kind, or a kind without a side-effect-free idempotent `verificationPoll`;
- a provider Verification `subjectKey` is not scoped by the originating Result Action, or its cadence/deadline functions read an implicit wall clock instead of their persisted timestamps;
- a durable task kind lacks a deterministic `subjectKey`;
- a task kind's `output_contract` permits an Object type outside its specialist's registry entry;
- a root can mutate a row whose `kind` is absent from its generated `compiledSupportedKinds`, or route an unknown kind through a fallback lane or brief;
- a kind allowed to call `scheduleRecheck` has no single registered `recheckKind`, maps it to a different root, or permits an immediate kind to collide with its future recheck under the same queue kind;
- concurrent enqueue for one logical key can create more than one `queued | running` task row, or replay of the row's creator/occurrence key can create another task after terminal settlement;
- an immediate enqueue conflict changes the existing task's `due_at`, payload, or rationale instead of returning it unchanged as `already_active`;
- `scheduleOrRescheduleTask` creates a second equivalent future booking instead of moving an existing scheduled booking, or treats the currently running equivalent task as that future booking instead of staging its successor in `next_*`;
- two authorized concurrent schedulers for one scheduled identity can leave more than one booking, mix fields from both calls, or produce anything other than the coherent tuple from the last valid database write;
- two authorized concurrent schedulers targeting one running recheck can leave more than one pending-successor slot, mix `next_*` fields from both calls, or cause normal completion to materialize anything other than exactly one successor from the last valid database write;
- an equivalent self-recheck updates `next_*` without the single `WHERE id = current_task_id AND status = 'running' RETURNING` statement, inserts or reschedules on a zero-row result instead of returning `task_closed`, or requires a general source-task lock/fencing protocol;
- concurrent self-recheck and settlement can both succeed after settlement, lose a scheduling update committed before successful completion, or let staged scheduling survive agent failure, cancellation, or direct/automatic exhaustion;
- `scheduleRecheck` accepts an arbitrary target `kind`, `task_id`, `brand_id`, `subject_key`, or `worker_key` from the model instead of deriving them from trusted eve session context and the registry relation;
- successful completion can finish a task with a pending successor without atomically leaving exactly one equivalent active booking, or a legitimate booking conflict rolls back the current success;
- agent failure/cancellation or direct/automatic `retireExhausted` can leave any `next_*` field, materialize a successor, or allow a later success transition after the terminal status won;
- two concurrent claimers can move the same queued agent row to running, or direct claimers can own one row under overlapping valid leases;
- an agent or human-commitment claim reads/increments `attempts`, a human commitment acquires a lease or is reclaimed, or a direct/automatic reclaim fails to increment it or exceeds `MAX_ATTEMPTS = 3`;
- an agent claim starts a session at zero autonomous-credit balance, a `direct/human` claim is blocked by that balance, or a generic claim helper reads it before branching on mode;
- an agent row with `session_id` can be reclaimed, or a stale sessionless handoff cannot return to `queued`;
- more than one terminal event can settle the same running task;
- an agent task calls eve without `mode: "task"`, stores more than one authoritative `session_id`, promises away the unrecorded-acceptance ambiguity, or uses `task:<task_id>` for a follow-up turn;
- `/internal/dispatch` exists outside the custom machine channel, accepts a task or tenant selector, skips `DISPATCH_SECRET` authentication or the route's `waitUntil`, or starts a claimed agent row without ``from(`task:${taskId}`).send(brief, { auth, mode: "task", outputSchema })`` and authoritative `session.id` binding;
- `finishTask` can target a task outside trusted session context, bypass the registered `TaskCompletion`, or make the row terminal itself;
- an agent task becomes `succeeded` from `result.completed`, `session.waiting`, a failure/cancellation event, or `session.completed` without a staged valid `TaskCompletion`; cancellation's expected following `session.waiting` is resumed or treated as success;
- a task-bound canonical mutation commits after task status is no longer `running`; a human commitment reaches `queued` without its exact Approval Action, invokes the provider more than once automatically, or violates ADR-019's lane checks; or any row violates the combined ADR-018/019 database checks;
- a valid queued Approval Action stops authorizing execution merely because its actor later loses membership or role, or cancellation and claim can both win for the same commitment;
- two serialized commitments sharing a brand and trusted conflict key can both become `queued | running`, a losing click commits an Approval Action or is auto-queued later, or claim accepts a persisted key that no longer matches the registered final payload;
- conflict exclusion leaks across brands or unrelated keys, applies to a registry-declared independent operation, or an asynchronous inverse pair is registered without effect finality, provider linearization, or conditional/versioned state;
- a root classifies another root's human commitment, classifies one before `STALE_AFTER`, returns stale `running` work to an executable state, or settles the stale task without atomically appending its Result Action;
- a bounded drain selects an older direct/automatic or agent row while an eligible supported `direct/human` row existed at the same claim snapshot, orders human work without `execute_before NULLS LAST` plus Approval time and id tie-breakers, or persists a generic priority field to implement the lane order;
- a preflight-only diagnostic consumes an execution slot, remaining batch capacity fails to flow to the next lane, or overlapping drains can claim the same row while applying the shared lane order;
- a human commitment handler does not return the closed `accepted | rejected | unknown` union, the generic dispatcher interprets provider-specific HTTP/SDK details, or an unexpected post-claim throw can settle `failed` instead of `outcome_unknown`;
- an accepted commitment that declares eventual verification settles without atomically creating/observing its first direct/automatic poll, a pending poll creates multiple successors, or a poll opens an eve/LLM session or performs an external write;
- a provider-domain failed job is treated as technical poll failure, a transient read error is treated as the job's final outcome, a deadline is checked after runtime capability, or technical exhaustion omits its final `unverified` Action;
- a direct/human registry entry lacks its typed handler or receipt schema, the dispatcher switch is not exhaustive, an invalid accepted receipt avoids immediate `outcome_unknown`, or the stale classifier emits a Result shape other than `unknown`;
- a billable human commitment can settle `succeeded` without exactly one same-transaction `action_charge`, any other outcome is charged, or a Verification later charges an unknown commitment;
- a valid `TaskCompletion` domain status of `partial` or `blocked` is treated as a technical failure instead of successful execution;
- a failed, cancelled, merely waiting, or invalid agent run can materialize staged `next_*`, or a direct task can require an eve completion event instead of settling from its deterministic handler result;
- a root can claim a task whose `worker_key` is not itself, start agent work outside its dispatcher path, execute direct work outside the responsible root, or avoid reloading its task by id;
- a specialist root's production `/eve/v1/info` or `/eve/v1/session*` routes accept any caller, its `/eve/v1/health` route requires authentication, or a token-addressed callback can create work without an existing pending hook/session;
- the cron fan-out waits for root drains instead of only their acknowledgments, lets one failed root suppress the other pokes, or depends on an eve schedule;
- a promoted consultation exceeds its schema or size cap;
- generated consultation and durable manifests drift from their shared registry entry.

Self-copies inherit the authority of the session that spawned them. CMO copies see only the same consultative specialist surface as the CMO; named specialist-root copies retain the parent root's work surface and remain inside the already-dispatched task. A copy cannot widen its parent's tools or turn consultation into durable work.

This is a capability boundary, not a prompt convention.

## Consequences

- Native in-process specialist consultation, structured returns, cancellation, and control-plane events remain available to the CMO.
- Every durable specialist outcome and commitment enters the task lane. The active-task constraint prevents equivalent ordinary work rows and creator keys protect exact replay, while independent commitment proposals intentionally keep distinct identities. Eve owns durability after authoritative session binding; only the documented unbound agent handoff and bounded retry-safe direct/automatic lease expiry can create application-level overlap. Human external commitments never auto-reclaim after claim.
- A consultation may overlap a durable task, repeat external reads, or return stale or conflicting advice; it still cannot commit either result.
- Declared specialist sessions no longer park on graph-write, boundary-action approval, or connection onboarding. A missing brand-owned read connection simply removes that capability and is surfaced to the application; `apps/app` owns any later brand-scoped connect flow.
- Durable autonomous sessions and CMO chat create the same `awaiting_approval` direct task at an external commitment boundary; neither parks an executable tool. The responsible root's plain-code lane executes after the click.
- The CMO receives immediate answers for consultation but receives task state for durable work. Agent tasks render scheduled, queued, running, succeeded, failed, or cancelled. Human commitments additionally render awaiting approval, unknown outcome, expired, needs regeneration, dismissed, and superseded. Reclaimable and awaiting-retirement are direct/automatic-only substates.
- An immediate duplicate request observes the active immediate task without rewriting its accepted brief or timing. A future recheck uses a distinct registered kind, so its active booking cannot swallow a request to do the work now. Only `scheduleRecheck` may reschedule an equivalent future booking; concurrent authorized calls atomically replace the single scheduled row or running row's single `next_*` tuple, with the last valid database write winning and no priority or merge. Successful completion materializes at most that one staged successor.
- The two modes require separate evals: consultation quality and read-only enforcement for the subagent; output-contract, provenance, idempotency, and task completion for the root.
- No cross-session waiter is required for deduplication. A future notification feature may announce task completion, but it is not part of the concurrency guard.
- A badly designed registry `subjectKey` can still over- or under-deduplicate work; registry tests and review own that semantic risk.

## Alternatives considered

- **Prompt-ordered check followed by native subagent call** — rejected: optional, non-atomic, and subject to a check/use race.
- **Dynamic subagent availability as the guard** — rejected: capability composition is not a per-call task claim, and eve documents it as insufficient as the sole authorization boundary.
- **Put every consultation through the queue** — rejected for now: strongest spend deduplication, but it removes the low-latency in-process consultation that motivated the interactive declaration.
- **Authored gateway that claims a task and invokes the root agent over HTTP** — deferred: it can recover synchronous-looking durable delegation, but adds self-call authentication, cross-session waiting, cancellation, approval relaying, and failure handling.
- **General source-task guard with `SELECT ... FOR UPDATE`** — rejected for scheduling: it adds an interactive transaction plus lock-ordering and retry concerns. The only required late-call guard is the self-recheck's single conditional update on the row it already targets.
- **Lease owner, heartbeat, per-attempt token, and write fencing for agent work** — rejected: the one-shot agent run has no application execution lease. ADR-019 also removes lease reclaim from human external commitments; only registered retry-safe direct/automatic work retains the bounded lease.
- **Conversation continuation or intentional multiple task-mode runs on one agent row** — rejected by ADR-018: one task stores one authoritative session and one terminal outcome; only unbound delivery recovery may resend, and a genuine product retry creates a new task.
- **CRM-style catch-all research lane for unknown kinds** — rejected: our task kind determines typed payload, output, owner, and execution mode, so version skew must leave the row untouched rather than guess after consuming an attempt.
- **Per-row `contract_version` and coordinated all-root deployment** — not adopted in v1: backward-compatible evolution, new kinds or explicit expand-contract rollouts, and the compiled supported-kind filter provide a smaller fail-closed protocol.
- **Import or patch eve private subagent execution internals** — rejected: the guard must not depend on an unsupported runtime seam.
- **Disable the specialist HTTP channel with eve's internal `disableRoute()` sentinel** — rejected: eve 0.31.3 does not export it from the supported `eve/channels` entrypoint. An explicit `eveChannel({ auth: [localDev()] })` is public, fails closed in production, and preserves local tooling.

## Out of scope

This ADR does not define tenant ACL resolution, authentication-context injection, membership checks, or query scoping. It only requires that `brand_id` come from trusted application context rather than model input; the ACL design remains a separate decision.
