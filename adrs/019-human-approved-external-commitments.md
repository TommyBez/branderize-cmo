# ADR-019 — Human-approved external commitments are direct tasks

**Status:** Accepted — 2026-08-09
**Deciders:** Tommaso, grilling session with assisted analysis
**Amends:** [ADR-001](001-multi-tenant-saas.md) (brand deletion), [ADR-002](002-postgres-work-graph.md) (task and Action lifecycle), [ADR-007](007-approvals-and-tasks-queue.md) (one approval path), [ADR-008](008-brain-write-path-and-model-resolution.md) (dismissal memory), [ADR-009](009-agent-deployment-and-console-data-surface.md) (deterministic owner and deletion), [ADR-010](010-plan-as-derivation.md) (human gate on every external commitment), [ADR-011](011-operational-invariants-for-agent-work.md) (proposal shape and drift), [ADR-012](012-contracts-approval-brief-intents-compiler.md) (approval source), [ADR-013](013-policy-matrix-lateral-edges-sandbox.md) (external-effect floor), [ADR-014](014-schema-singletons-sessions-streams-ledger.md) (task schema), [ADR-015](015-the-registry.md) (direct task kinds), [ADR-017](017-consultative-subagents-durable-root-work.md) (direct execution), and [ADR-018](018-one-shot-durable-agent-tasks.md) (direct-lane retry policy)
**Refs:** trycompai/crm commitment precedents at [`682ae0f1`](https://github.com/trycompai/crm/tree/682ae0f1f7f5c4d2737b72dbf9941e7463693e42): [`AgentAction`](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/packages/db/prisma/schema.prisma#L766-L801), [exact-call idempotency and transactional local effect](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/lib/run-runtime.ts#L169-L350), the [closed create-only tool](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/subagents/agent_runner/tools/create_crm_activity.ts#L6-L23), and its durable authorization precedent: [membership is checked when a manual run is accepted](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/api/src/agent/agent-runs.service.ts#L125-L203), while [dispatch uses the persisted initiator without rechecking membership](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/agent/agent/lib/custom-agent-dispatch.ts#L274-L345). Current CRM custom-channel ingress at [`c56b3fd`](https://github.com/trycompai/crm/blob/c56b3fd952b035c1b286d35c777e023527cc96bf/apps/agent/agent/channels/crm.ts#L47-L64). Vercel Functions: [Fluid Compute](https://vercel.com/docs/fluid-compute), [`maxDuration`](https://vercel.com/docs/functions/configuring-functions/duration), and [`waitUntil`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil).

## Context

The earlier design represented an executable proposal as an Object, used different approval behavior in chat and in autonomous work, and let every deterministic direct task inherit a two-minute lease with three claims. Those choices do not compose cleanly for third-party writes:

- the same human decision could be owned both by a resumed eve tool and by a direct worker;
- a lease retry can repeat an external request whose first outcome is unknown;
- a separate Proposal Object duplicates the lifecycle already needed on the execution task;
- a provider accepting a command is not always the same thing as the eventual remote effect completing;
- the old policy still allowed some external commitments automatically, including the nominally safe direction.

The current CRM is useful but does not solve this exact product flow. Its autonomous runner uses a closed tool set and an `AgentAction` ledger, but its only business write is `crm.activity.create`: a create-only effect committed in the same Postgres transaction as `AgentAction -> SUCCEEDED`. It has no current provider write that waits in an approval inbox and no asynchronous external outcome. We copy its closed, authored capability surface and exact-call idempotency discipline; the human-per-effect gate and external outcome boundary are Branderize adaptations.

## Decisions

### D1 — Preparation and commitment are different capabilities

The registry classifies an operation by effect phase in trusted code; the model and prompt never classify it.

- **Internal preparation** writes Objects, assets, and task payloads in Branderize.
- **External preparation** is allowed autonomously only when the provider exposes a genuinely non-committal staging primitive, such as creating a private draft. The agent-facing surface is create-only: one authored operation for one registered draft kind, never generic `mutate`, `update`, `delete`, `publish`, or arbitrary connector invocation. Its registry entry must classify replay as `idempotent`, `recoverable` by deterministic provider lookup, or `duplicate-safe`.
- **External commitment** changes authoritative external state: schedule, publish, send, activate, spend, merge, pause, unpublish, cancel, or close. Every such operation requires a human button. Reversibility and the nominally safe direction do not remove this floor.

An agent composes and revises internally, then intends one external draft for handoff. Eve may rerun a step interrupted before its checkpoint. An `idempotent` operation reuses a stable provider key; a `recoverable` operation finds the already-created draft deterministically; a `duplicate-safe` operation is explicitly at-least-once and accepts occasional duplicate or orphaned private drafts. The stable application-side creator key still prevents the replay from silently creating a second canonical commitment task, but it cannot erase a provider-side orphan. If duplication would publish, notify, spend, consume a material scarce resource, or otherwise matter to the user, the operation is not `duplicate-safe`: preparation stays internal until the human-approved commitment. A later intentional agent revision creates a new draft and commitment task and never mutates or deletes the old provider draft.

Connecting OAuth and approving a commitment are separate consents. A connected account makes an operation possible; it does not authorize the pending payload.

### D2 — A proposal is a direct task in `awaiting_approval`

There is no separate executable Proposal Object or Proposal table. “Proposal” is the product and UI name for a `tasks` row whose registry entry has:

```text
execution_mode = direct
activation     = human
status         = awaiting_approval
```

The commitment task is distinct from the parent agent task that prepared it. The parent may later succeed, fail, or be superseded by a later Plan exclusion without changing a valid pending commitment. A newly inserted commitment receives insertion-only `parent_task_id = preparing_source_task_id`; the model/browser cannot provide it, and observing an existing commitment never reparents it. A later retry or replacement likewise points to the previous commitment in `parent_task_id` in addition to its specific `retry_of_task_id` or `supersedes_task_id` relation. Parent provenance does not make the child transactional with the parent result. `publishPlanAndRoute` never targets a commitment row, including one that preserves the excluded Move's Plan/Move origin. For a task-bound `prepareCommitment`, trusted context derives the common origin from that parent: an Intent-bound source creates new work against the current Intent revision, while a Plan-routed source preserves null Intent plus the exact Plan/Move pair and requires the target commitment kind to declare `acceptsPlanRouteOrigin: true`. The model cannot submit or replace these fields. After any terminal outcome of a Plan-routed commitment, the ordinary post-commit wake-up may follow that immutable same-origin chain to a current-Plan adopted ancestor; it still grants no external authority and never makes the commitment a Plan route. Origin-free provider-outcome polls remain outside that chain.

Interactive CMO chat and autonomous roots create the same pending task through the same brain function. Neither path parks an eve approval for an external commitment. Chat and the approval inbox render the same task, and both invoke the same `approveTask` operation. An eve callback, if used only for presentation, may observe the receipt but never call the provider.

After approval, execution belongs to the task kind's responsible specialist **application**, not to an LLM and not to `apps/app`. The Next.js action queues the row and pokes the responsible root deployment; that deployment's dispatcher claims the direct row and calls its registered plain TypeScript handler. No eve session, continuation token, model call, or agent prompt participates in this execution, but the terminal Result Action still uses the responsible root's registry Actor because the handler executes that root's registered capability; it does not invent a system Actor.

Selecting many proposals is only a UI convenience. The server attempts independent per-task approval transactions and returns per-item results; there is no batch table, shared status, or all-or-nothing provider transaction. Independence does not waive the D3 conflict guard: two selected proposals that address the same serialized external target cannot both become approved work.

### D3 — The click authorizes one final task revision

`approveTask` is the only operation allowed to change a human-activation kind from `awaiting_approval` to `queued`. It requires a current Better Auth human session. In one database transaction it:

1. loads the task's immutable `brand_id` and its brand's `organization_id`, then reads the exact Better Auth `Member(organization_id, user_id)` with `SELECT ... FOR SHARE` and rejects a missing or insufficient organization-wide role;
2. materializes or reloads the one global human Actor for that Better Auth `user_id`;
3. locks or compares-and-swaps the exact task revision still in `awaiting_approval`;
4. validates the registered schema and canonical payload hash;
5. derives the worker, effect signature, scope, external-effect cost bound, preview manifest, connector operation, receipt schema, concurrency policy, optional conflict key, and billing branch from the final payload and closed registry entry;
6. builds the human Policy context from the global audit Actor identity plus the current role read from the locked Member row, then evaluates Policy;
7. appends an Approval Action containing the task id and revision, actor, final payload hash, effect signature, `policy_snapshot`, authorized external-effect cost bound, and the resolved billing snapshot (`non_billable` or fixed `price_key`, `pricing_version`, currency, and unit amount);
8. stores `approval_action_id`, `approved_at` from the same transaction timestamp, and the derived `commitment_conflict_key`, if any, on the task and changes it to `queued`.

Role downgrade and organization-membership removal update or delete that same Better Auth Member row. PostgreSQL therefore serializes them against the shared lock: if approval acquires it first, the already-authorized approval commits and revocation follows; if revocation commits first, approval sees the weaker role or no row and writes nothing. This copies the current CRM Agent-deploy boundary without adding `SERIALIZABLE`, a membership version, claim-time reauthorization, or an offboarding watcher. All human approval paths use the order Member, `ensureHumanActor`, task, then optional commitment-conflict advisory lock. A role change applies to every brand in that organization; there is no Better Auth Team or brand-membership row to update.

For humans, `actors` is durable identity and audit attribution only. One Better Auth User has one Actor globally, with no organization or brand columns; joining another organization or changing role does not create another identity. `actors.role` or a copied Actor capability must never authorize the click: it can be stale after an organization-role change. The locked Better Auth Member is the current source of authorization, while the resulting Action's `policy_snapshot` freezes the organization role and verdict actually used at approval time. Human boundaries use the common lock order Member → `ensureHumanActor` → protected task/resource → optional conflict key.

The generic enqueue API rejects `activation = human` kinds. Database checks require `activation = human -> execution_mode = direct` and require `approval_action_id` from `queued` onward. For a registry entry marked `serialized`, `approveTask` derives the key from the final payload, acquires a transaction-scoped advisory lock over `(brand_id, commitment_conflict_key)`, and checks for a `queued | running` owner before appending the Action. If one exists, the transaction writes nothing, the proposal remains `awaiting_approval`, and the API returns the diagnostic `target_busy` plus the blocking task id; `target_busy` is not a task status. Otherwise the same transaction persists the key and approval under a partial unique constraint that permits at most one active owner. The advisory lock makes concurrent clicks deterministic and lets the service report the blocker; the unique index remains the database backstop. No FIFO or implicit later approval is created. The Approval Action's actor, task id, revision, hash, and conflict key cannot all be proved by a row-local `CHECK`; `approveTask` writes them in one transaction, and the deterministic claim re-derives and validates that receipt and key before changing `queued -> running`. The machine worker never reconstructs the approving user from HTTP headers. This interactive transaction is implemented through ADR-005's canonical Drizzle/`pg` adapter; a predeclared Neon HTTP batch is not an equivalent implementation.

Human edits are allowed only while the task is still awaiting approval. `editTask` and its human Edit Action are one transaction whose update compares both `status = 'awaiting_approval'` and the exact expected `revision`; zero updated rows returns `stale_revision` or `task_closed` and commits neither change. A valid same-kind edit increments `revision` and causes policy and preview data to be derived again. `approveTask` uses the symmetric guard, so whichever operation wins makes the other stale and a payload can never change after its Approval Action is written. An edit that changes the registered kind, executor, or operation supersedes the old task and creates a new one rather than reinterpreting it in place.

The execution handler resolves the brand-owned current active connection for the registered provider at execution time. That durable connection has `brand_id`, not a user owner; the approving user and the human who originally connected it are audit Actors, never the credential identity used by the headless root. V1 deliberately does not pin a provider account or connection id in the Approval Action and does not perform a stale-draft readback/hash gate. If the user changes the connected account or edits provider state and then clicks, the resulting operation is their responsibility. Tenant scoping and the registered connector operation remain mandatory; only the extra reapproval protocol is rejected.

A committed Approval Action is a durable grant, not a promise to re-evaluate the approver or write Policy later. The approver's organization membership, role, current `policy_restriction` heads, effect signature, and cost bound are authoritative at the click and are preserved in `policy_snapshot`; a later role/restriction change does not invalidate an already-`queued` task. Claim validates the persisted task/revision/hash/Approval relationship plus current registry, connection, deadline, and deterministic safety preflight, but deliberately does not reload the former approver's Member row or rerun Policy. To stop a grant before execution, an authorized current human must win `cancelTask` before claim. Offboarding removes Membership and sessions but retains the global User/Actor audit identity; it creates no task watcher and performs no implicit cancellation. Likewise, removing the human who originally proposed or edited a task still in `awaiting_approval` does not cancel that task: another currently authorized member of the same organization may approve it, while the removed human can no longer perform the click.

Stopping an already approved commitment is a separate explicit administrative operation. An authorized current human calls `cancelTask`. In one transaction it appends the task-linked Cancellation Action, performs a compare-and-swap from `awaiting_approval` or `queued` to terminal `cancelled`, and fills `finished_at`; if the compare-and-swap affects zero rows, the Action rolls back too. Cancellation and claim therefore have one winner: if cancellation commits first, the provider cannot be called; if `queued -> running` commits first, cancellation affects zero rows and cannot revoke the possibly in-flight effect. Brand deletion remains the separate tenant-wide cascade in D7.

### D4 — External commitment execution is one-shot

The persisted lifecycle is:

```text
awaiting_approval -> queued -> running
running -> succeeded | failed | outcome_unknown

awaiting_approval -> dismissed | superseded | needs_regeneration | cancelled
queued             -> expired | needs_regeneration | cancelled
```

The UI may label `running` as “executing”. Every state on the right is terminal and has `finished_at`; `awaiting_approval`, `queued`, and `running` are nonterminal.

Delivery and wake-up may retry while the task is still `queued`, because no provider operation has started. The dispatcher may scan ordered candidate ids without mutating or reserving them. Once one bounded per-invocation worker slot selects an id, the responsible root completes every deterministic preflight that can reject the operation without contacting the provider while the row is still `queued`. A temporarily missing runtime capability, such as a disconnected provider, leaves the row `queued` with a visible diagnostic; autonomous AI-credit balance is explicitly **not** such a capability for this lane. An expired deadline changes the row directly to `expired`, and a payload or registered contract that can no longer be executed safely changes it to `needs_regeneration`. None of those paths calls the provider or consumes an execution start. Neither `approveTask`, this preflight, nor the claim reads the agent credit balance. The claim transaction then verifies the integrity of the persisted Approval grant, exact final task revision and hash, supported kind, recorded effect signature and connector operation, current registry compatibility, and deadline before atomically changing that one row `queued -> running`. It does **not** rerun Policy against the current Actor, role, membership, or `policy_restriction` heads. That claim is the point of no return and happens immediately before external execution. The same slot enters this task's handler as soon as the claim commits, waits for terminal settlement, and only then selects another candidate; it never pre-claims a batch. After the claim, the handler makes **at most one provider call**:

- it has no execution lease, reclaim path, `MAX_ATTEMPTS`, or automatic queue retry;
- generic SDK retries are disabled unless the provider documents that the same stable idempotency key cannot repeat the effect;
- only a connector-classified rejection that proves the provider did not apply the effect becomes `failed`;
- a timeout, process death, response-loss window, or receipt-less ambiguous response becomes `outcome_unknown`;
- a stale `running` task is terminalized as `outcome_unknown`, but is never returned to `queued`, `expired`, or any other executable state and never calls the provider again.

Each responsible root owns this recovery for its own compiled human-commitment kinds. At the beginning of every `/internal/dispatch` drain, before claiming new work, it selects its own `running` human tasks older than `STALE_AFTER` and uses D5's atomic Result settlement to close them as `outcome_unknown`. A failed or offline root merely postpones classification until a later healthy poke; it does not make another provider call.

After that separately bounded classification, approved human commitments receive the first claim opportunity whenever an invocation worker slot becomes free. They are ordered by earliest `execute_before` with null deadlines last, then by task `approved_at` and id. `approved_at` is lifecycle data copied from the Approval transaction, not caller-authored priority; the transaction guarantees that it agrees with the linked Action. Candidate scanning may cache ids, but only the slot that is about to execute performs preflight and the one-row claim. An expired, incompatible, temporarily blocked, or lost-CAS candidate is terminalized, diagnosed, or skipped according to this ADR and does not increment `DRAIN_BATCH`; the counter advances only after a claim actually starts execution. That slot runs the provider handler and settles before taking another row. Other bounded slots in the same invocation may do the same concurrently. Capacity left after human starts flows to retry-safe direct/automatic work and then agent work, with lane preference evaluated at each claim rather than frozen in a pre-claimed batch.

`DRAIN_BATCH` is therefore an invocation-local bound on executions actually started, distinct from the small invocation-local in-flight concurrency bound and from candidate scan limits. It is not a root-wide semaphore: Vercel Fluid Compute may overlap multiple invocations or instances, each applying its own limits and using Postgres CAS to claim disjoint rows. Aggregate concurrency may exceed either invocation-local number. V1 adds no global semaphore or pre-claim reservation protocol.

Every provider handler uses the explicit `PROVIDER_HTTP_TIMEOUT = 90s`, and each Eve custom-channel dispatcher stays on its generated shared Vercel Function. V1 uses Fluid Compute's uncustomized 300-second Default Max Duration: the route exports no `maxDuration`, application configuration defines no `ROOT_MAX_DURATION`, longer opt-in durations are disabled, and no post-build step patches `.vc-config.json`. `waitUntil` lets the drain continue after the `202` acknowledgment but remains bounded by that same Function lifetime; it is not a durable worker. The stale classifier waits for `STALE_AFTER = 10m`, keeping it outside the lifetime of an invocation Vercel is still allowed to run. Any project-duration change is a reviewed deployment change and requires an accompanying review/update of `STALE_AFTER` before rollout. Deployment and Eve-upgrade verification may inspect the resolved shared-Function configuration to protect this assumption, but v1 has no permanent generated-artifact patcher. Immediate handler entry minimizes but cannot remove the small crash window after `queued -> running` commits and before the first provider byte. That row is conservatively classified `outcome_unknown` after 10 minutes. No pre-call marker is stored: a timestamp written before HTTP would not prove that any byte reached the provider, and safely returning its row to `queued` would require a fenced claim generation that v1 deliberately does not add.

A user who wants to try again after `failed` or `outcome_unknown` performs another explicit approval. The application creates a new task and Approval Action linked by both `retry_of_task_id` and immutable `parent_task_id = previous_task_id`; it never reopens the old row. The UI warns that an `outcome_unknown` retry may duplicate an effect.

The brand's autonomous AI-credit balance is not a claim precondition for this lane. A `direct/human` task whose Approval Action is valid proceeds even when that balance is zero because it starts no model session. If its registered boundary operation is billable, exactly one `action_charge` keyed by `action_id` is created **only when the task reaches `succeeded` with a validated stable receipt**; consumption beyond the included pool follows the paid-overage path. `failed`, `outcome_unknown`, `expired`, `cancelled`, and `needs_regeneration` are not charged. Agent credit and soft work-budget enforcement remain separate and cannot be placed in the shared claim predicate.

`execute_before` is optional and derived or validated by the registered kind. The worker checks it in the final preflight immediately before claim. If it has passed, the task changes directly from `queued` to terminal `expired` without a call. A request claimed before the deadline may finish or be classified afterward; the deadline never authorizes a new late retry.

Other deterministic **internal** direct kinds may keep a bounded, transaction-safe retry policy. The one-shot rule applies to human-approved external commitments and must be selected from the registered kind before any generic direct claim helper runs.

### D5 — Provider acceptance and eventual outcome are separate facts

For a commitment task, `succeeded` means the provider durably accepted the exact authorized command and returned a stable receipt. It does not necessarily mean that a post has already published, a campaign has finished, or a message has been delivered.

Every registered commitment handler returns one closed provider-independent result:

```ts
type CommitmentOutcome<Receipt> =
  | { outcome: "accepted"; receipt: Receipt }
  | { outcome: "rejected"; code: string; message: string }
  | { outcome: "unknown"; code: string; message: string };
```

The connector is the only layer allowed to interpret its provider's HTTP statuses, SDK errors, and response body. It may return `rejected` only when the provider contract proves that the command was not applied. Timeout, network failure, response loss, malformed response, missing or invalid receipt, and any other ambiguity return `unknown`. If the handler unexpectedly throws after claim, the dispatcher catches it and also classifies it as `unknown`; a generic catch must never manufacture `rejected`. The dispatcher does not inspect HTTP or SDK details: it exhaustively maps `accepted` to `succeeded`, `rejected` to `failed`, and `unknown` to `outcome_unknown`. An `accepted` receipt is validated by the registered `receiptSchema` before settlement; validation failure is ambiguous and therefore maps to `outcome_unknown`, not `failed`.

- A synchronous final response with a stable receipt is `succeeded`.
- An asynchronous acceptance such as `202` with a stable job, schedule, or external id is also `succeeded`. The UI says “accepted”, “scheduled”, or “submitted”, according to the kind; it does not claim the eventual effect already happened.
- An acceptance without a stable receipt or lookup identity is `outcome_unknown`.

The commitment task does not remain `running` until a provider job finishes, and v1 adds no universal `pending_provider` state. Therefore two inverse, stateful operations whose successful response is only asynchronous acceptance may share a serialized conflict key only when the provider contract linearizes accepted commands for that target or the connector uses a conditional/versioned state transition that rejects stale work. Otherwise that pair is not enabled in v1; a database guard that ends at acceptance would make a false ordering promise.

If the product needs the eventual result, the commitment kind names one registered same-root Verification task. In the same Postgres transaction that appends `accepted(receipt)`, settles the commitment, and inserts any charge, code derives the provider lookup identity from the schema-valid receipt and creates or observes the first `direct/automatic` poll task. This poll is registered origin-free work: Intent/snapshot and Plan/Move are null, Policy records `structure_level = null`, and the Result Action supplies its complete causal provenance regardless of the commitment's origin. Its idempotency key is stable from `(result_action_id, verification_kind, check_number = 0)` and its active-work subject is scoped by that same Result Action; its payload references the Result Action plus validated lookup data and a registry-derived deadline. The first due time and deadline derive from the persisted Result Action timestamp rather than an implicit wall clock. Failure to create or observe that task rolls back the local acceptance settlement too. No webhook, public provider-callback endpoint, `provider_events` inbox, or assumption about provider webhook retry exists in v1.

The responsible root later handles the due poll through the bounded-retry `direct/automatic` lane. Its claim path checks the registered deadline before resolving a provider connection or any other runtime capability. If the deadline has passed, it claims the row through the ordinary direct/automatic CAS but performs no provider read; settlement appends a provider-outcome Verification Action `{ state: "unverified", code: "deadline_reached" }`, links it to both the originating Result Action and the current poll task, marks that poll task technically `succeeded`, and creates no successor. A missing provider capability before the deadline leaves the poll queued with a visible diagnostic; it cannot leave the row queued forever because the deadline branch runs first on later ticks.

Before the deadline, the root calls the registered side-effect-free idempotent provider read in plain TypeScript, with no eve session, LLM, AI Gateway generation, agent-credit gate, or external write. Every schema-valid provider observation appends a provider-outcome Verification Action linked to both the originating Result Action and the poll task. `pending`, `completed`, provider-domain `failed`, and provider-domain `unverified` all mean that the polling code ran successfully, so the current poll task settles as `succeeded`; only `pending` also creates or observes a successor. For `pending`, the transaction persists one observation timestamp, first moves the current row out of the active partial index, then derives `due_at` from that timestamp and inserts or observes exactly one next origin-free occurrence with stable key `(result_action_id, verification_kind, check_number + 1)`. Thus the successor retains the same Result-scoped semantic subject without conflicting with the current occurrence, and exact replay cannot change its canonical timing fields.

A transient transport, authentication-refresh, or schema error is a technical poll failure and uses the existing bounded `direct/automatic` retry. On every tick, an expired lease already at `MAX_ATTEMPTS` is retired as `technical_exhaustion` before deadline eligibility is considered; otherwise the deadline branch precedes capability checks and a new claim. The retirement transaction marks the poll task `failed`, appends one final provider-outcome Verification Action `{ state: "unverified", code: "technical_exhaustion" }` linked to the Result Action and poll task, and creates no successor. This is distinct from a valid provider response saying that its job `failed`, which leaves the poll task `succeeded`. The provider's final state never reopens or rewrites the already-settled commitment task, changes its charge, or by itself contests a marketing Decision. A provider without a durable lookup contract gets no automatic Verification task: `succeeded` continues to mean only that its command was accepted.

Every terminal provider-outcome Verification—`completed`, provider-domain `failed`, provider-domain `unverified`, `unverified(deadline_reached)`, or `unverified(technical_exhaustion)`—commits with its poll settlement before any Plan work is requested. Only after that commit, ADR-021's dedicated best-effort creator may use the immutable Verification Action as a new wake-up event. Trusted code accepts only its internal `verification_action_id`, then revalidates the exact same-brand chain: the Action is a terminal provider-outcome Verification, `Verification.task_id = poll.id`, `poll.result_action_id = Verification.id`, `Verification.origin_result_action_id = Result.id`, `Result.task_id = commitment.id`, and `commitment.result_action_id = Result.id`; that Result is `accepted(receipt)` and the commitment is `direct/human + succeeded`. It applies the ordinary current-Plan adoption/ancestry checks to that originating commitment. The poll row itself remains origin-free and never acquires Intent or Plan/Move provenance. The event creator key is distinct from the commitment's earlier terminal signal and is scoped by the exact Verification Action plus candidate Plan, for example `plan-advance-provider-final:<verification_action_id>:<candidate_plan_id>`. A `pending` Verification never invokes this creator. A non-Plan commitment, stale Plan, broken/cross-brand causal chain, or failed post-commit enqueue creates no Plan work; none can roll back or rewrite the already-canonical Verification.

This adapts the current CRM's polling-first sync discipline: its authenticated cron route invokes durable mailbox synchronization, while Gmail push/Pub/Sub is explicitly deferred until polling has proven the matching rules ([current sync route and bounded loop](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/api/src/sync/sync.controller.ts#L15-L64), [mailbox polling loop](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/apps/api/src/sync/mailbox-sync.service.ts#L36-L113), [push deferred](https://github.com/trycompai/crm/blob/682ae0f1f7f5c4d2737b72dbf9941e7463693e42/docs/plan/gmail-calendar-plan.md#L606-L612)). Branderize uses the existing Next.js cron fan-out and task queue rather than the CRM's Nest sync service.

The stale-run classifier produces the same `unknown(code, message)` Result shape, with a deterministic stale-classification code; it does not invent a fourth settlement path.

Once the provider call has returned or its outcome has been classified, local settlement is one Postgres transaction. It appends exactly one Execution/Result Action and performs a compare-and-swap from `status = 'running'` to `succeeded`, `failed`, or `outcome_unknown`, filling `result_action_id` and `finished_at`. For a billable `succeeded`, the same transaction also inserts the sole `action_charge` using the fixed unit amount, currency, and pricing version frozen in the Approval Action; a missing receipt or one rejected by the registered `receiptSchema` makes this branch impossible. When the kind declares eventual verification, that transaction also creates or observes the first poll task. A non-billable success and every other outcome insert no charge. If the compare-and-swap affects zero rows, the charge insert fails, or the required poll task cannot be created/observed, the transaction rolls back the Action, task transition, charge, and poll together. The stale-run classifier uses the same transaction for `outcome_unknown` and never charges it. This cannot make the provider call atomic with Postgres: a crash after external acceptance but before this transaction still leaves the deliberately conservative, uncharged unknown-outcome case. It does prevent a persisted receipt, task state, customer charge, and required follow-up from disagreeing.

A later Verification may prove that the provider probably or actually applied an `outcome_unknown` commitment, but v1 does not backfill its `action_charge`. That unbilled effect is Branderize COGS or lost revenue. A provider/kind whose unknown rate makes that economically unacceptable is not enabled as a billable commitment until it offers a reliable receipt contract.

### D6 — Identity, dismissal, supersession, and contract evolution stay explicit

Creator idempotency remains exact, not semantic:

- the same `idempotency_key` plus the same canonical creation request hash returns the same task;
- the same key with a different hash is an error;
- a new key creates a distinct commitment task even when target and payload resemble another task.

Commitment tasks use a proposal-specific stable subject identity, for example `commitment:<task_id>`. The active-work identity index therefore does not collapse two independently intended proposals by account, campaign, target, or payload hash. The separate nullable `commitment_conflict_key` is not semantic deduplication: it leaves both proposal rows visible and prevents only simultaneous approval/execution of registered non-commutative commands on the same stateful target. Trusted code may derive it from validated final-payload fields such as provider plus logical target, but the model or browser cannot submit a precomputed key. Derivation does not resolve the mutable execution-time connection; conservative over-serialization after an account switch is accepted. The key is not implicitly the `subject_key` or effect signature. V1 adds no `task_request_keys` alias ledger.

Revision and regeneration are explicit. A replacement task carries `supersedes_task_id` plus immutable `parent_task_id = replaced_task_id`, and the old pending task becomes `superseded`; a stale click cannot approve it. A human dismissal changes the task to terminal `dismissed` and appends a Dismissal Action with actor, rationale, and timestamp. Exact recreation of the same `(brand_id, kind, canonical payload hash)` is blocked until a human records an explicit Reopen Action. `prepareCommitment` first validates the target kind against the trusted source origin, then serializes this check and insert with a transaction-scoped advisory lock derived from that tuple and reads the latest Dismissal/Reopen fact before inserting. Reopen acquires the same tuple lock before appending its Action. This is exact dismissal memory, not a fuzzy semantic fingerprint and not a new alias table.

The registered `kind` is the executor contract. A published kind changes only backward-compatibly. A breaking payload, preview, policy, handler, connector operation, `independent | serialized` classification, conflict-key derivation, or accepted-ordering contract uses a new kind. Pending old rows that can no longer be executed safely become `needs_regeneration`; they are never auto-migrated or interpreted by a new handler. The release that removes support must first terminalize those rows or retain the old handler until they drain.

### D7 — Tasks hold execution state; Actions hold authorization and facts

The same `tasks` table remains the mutable operational record. Human-approved commitment rows add or use these fields:

```text
activation, revision, payload_hash, approval_action_id, approved_at,
result_action_id, commitment_conflict_key, execute_before,
supersedes_task_id, retry_of_task_id
```

The closed task-kind registry fixes the payload schema, preview renderer, policy derivation, responsible worker, typed commitment handler, connector operation, and provider-success semantics. Unknown kinds have no generic executor or fallback connector method, and the generic dispatcher has no provider-specific status or error classifier.

Database checks hold the lane split:

- `execution_mode = agent` requires `activation = automatic`, `attempts = 0`, and no direct execution lease;
- `execution_mode = direct AND activation = automatic` is the only combination that may use the existing bounded-retry direct lease and attempts; its registered handler is limited to a transaction-safe internal operation or a side-effect-free idempotent external read, never an external write;
- `execution_mode = direct AND activation = human` requires `attempts = 0`, `leased_until IS NULL`, no eve session or staged `TaskCompletion`, and no `next_*`; `revision` and `payload_hash` are mandatory;
- a serialized human commitment has `commitment_conflict_key IS NULL` while awaiting approval and a non-null registry-derived value from `queued` onward; an independent kind always leaves it null;
- a human task in `queued`, `running`, `succeeded`, `failed`, `outcome_unknown`, or `expired` requires `approval_action_id`; `running` requires `started_at`, and every terminal state requires `finished_at`;
- `approved_at` is null before approval and mandatory from `queued` onward; `approveTask` fills it from the same transaction timestamp as the Approval Action;
- a human task in `succeeded`, `failed`, or `outcome_unknown` requires exactly one linked `result_action_id`, written in the same settlement transaction.

Foreign keys and uniqueness protect the Action links. A provider-outcome Verification Action has `origin_result_action_id` plus its ordinary `task_id`; the target tables expose `UNIQUE(brand_id, id)`, so composite foreign keys `(brand_id, origin_result_action_id)` and `(brand_id, task_id)` keep both references in the same brand. A partial `UNIQUE(task_id) WHERE type = 'provider_outcome_verification'` permits exactly one such Action per poll occurrence. Cross-table agreement on Action type, actor, task revision, and payload hash is enforced by the approval transaction and revalidated by claim, because ordinary SQL `CHECK` constraints cannot inspect another row.

The conflict guard is a separate partial unique index:

```sql
UNIQUE (brand_id, commitment_conflict_key)
WHERE activation = 'human'
  AND status IN ('queued', 'running')
  AND commitment_conflict_key IS NOT NULL
```

Cancellation or terminal settlement releases that database slot but does not approve any proposal that previously received `target_busy`; the human must click it again. `outcome_unknown` remains subject to D4's already accepted explicit-retry rule: a later click is a new authorization with a visible duplicate/ordering warning, not an automatic continuation. The guard prevents known concurrent dispatch; it does not claim to reconstruct an unknowable previous provider outcome.

Actions remain append-only during the brand's lifetime:

- the Approval Action proves who authorized which task revision and policy result;
- the Cancellation Action proves which current human stopped an unclaimed commitment; it commits with `cancelled` and `finished_at` in the same transaction and never exists for a lost cancellation race;
- the terminal Execution/Result Action records the responsible root actor, links `authorized_by_action_id`, and stores exactly one discriminated result: `accepted` plus the validated receipt, `rejected` plus code/message, or `unknown` plus code/message. The effective provider account identity is also recorded when exposed; any task-level error projection is derived from this same value in the settlement transaction;
- later provider-outcome Verification Actions link both the originating Result Action and their poll task and record `pending`, `completed`, provider-domain `failed`, or `unverified` with a reason such as `deadline_reached` or `technical_exhaustion`; they are distinct from Decision-impact Verification judgments and no provider webhook writes this log in v1.

Technical attempts are not separate human Actions. The task owns mutable lifecycle; the Actions preserve authorization and externally meaningful facts.

Every internal brand-scoped row, including tasks, Actions, Objects, intents, conversations, and session events, has a real foreign-key path to `brands`, with `ON DELETE CASCADE` along that path. Deleting a brand therefore hard-deletes those internal records through database cascades. Append-only means “not rewritten during the brand's lifetime”, not “retained after tenant deletion”. External drafts and effects are not cleaned up and may remain orphaned. A provider call already in flight when deletion commits may still finish; v1 adds no cross-system revocation or cleanup protocol.

## Contract tests

The implementation is invalid if any of these are possible:

- a model, prompt, or payload chooses its own effect class, worker, renderer, connector, or provider method;
- an agent receives a generic external mutation tool or can update, delete, publish, pause, or otherwise commit through its draft-preparation surface;
- an external-preparation operation is enabled without registered `idempotent`, `recoverable`, or explicitly `duplicate-safe` replay semantics, or a duplicate-safe operation is presented as exactly-once;
- a human-activation kind enters `queued` without the exact human approval transition and Approval Action;
- a claim re-evaluates the former approver's current Better Auth Member row, role, or current `policy_restriction` heads; offboarding or a post-click restriction silently revokes an already committed Approval Action; a restriction committed before the click is ignored by approval; or administrative cancellation can win after `running`;
- removing a proposer silently deletes or cancels its still-unapproved task, a removed member can still approve it, or a Cancellation Action can commit without the matching `cancelled` transition and `finished_at`;
- approval and organization-role downgrade/removal can both commit without contending on the exact same Better Auth Member row, a revocation that committed first still permits approval, `actors.role` authorizes a human operation, the same Better Auth User obtains different Actor ids across organizations or concurrent first writes, or code acquires approval locks in an order other than Member then Actor then task then optional conflict key;
- a zero autonomous-credit balance blocks a valid `direct/human` claim, the balance check is placed in a shared claim helper, or replay of one billable Result Action creates multiple `action_charge` rows;
- `failed`, `outcome_unknown`, `expired`, `cancelled`, or `needs_regeneration` produces an `action_charge`; a billable `succeeded` lacks one; a charge uses current pricing instead of the approved pricing snapshot; or a later Verification backfills an unknown task's charge;
- a non-billable `succeeded`, `dismissed`, or `superseded` task is charged; a billable commitment lacks a registered receipt schema or pricing snapshot; external cost bounds are confused with the fixed Branderize unit charge; or failure to insert the charge does not roll back Result settlement;
- concurrent or replayed settlement creates more than one charge for an Action; zero balance prevents the successful charge transaction from taking the ledger negative; a `202` with a valid stable id fails to charge as `succeeded`; or a `202` without that receipt is charged instead of becoming uncharged `outcome_unknown`;
- a stale task revision is approved, Policy is evaluated from pre-edit rather than final payload data, or an edit commits after approval/against a different expected revision;
- chat approval and the direct dispatcher can both execute the same provider operation;
- an external commitment task is reclaimed after `running`, invokes the provider more than once automatically, or uses the generic three-attempt direct policy;
- a preflight failure leaves an unclassified task state, turns a transient missing capability into an external call, or uses terminal `failed` for a provider request that was never claimed;
- a root has no stale-run classifier for its human commitments, classifies them before `STALE_AFTER = 10m`, uses a `PROVIDER_HTTP_TIMEOUT` other than 90 seconds, defines `ROOT_MAX_DURATION`, exports a route `maxDuration`, patches Eve's generated `.vc-config.json`, enables a longer opt-in Function duration in v1, or assumes `waitUntil` outlives the shared 300-second Function; a later project-duration change ships without reviewing/updating `STALE_AFTER`;
- a crash after the one-row claim but before the first provider byte creates a pre-call marker, fence, or safe-requeue path, or is later classified as anything other than conservative `outcome_unknown`;
- a claimable approved commitment sits behind agent/internal work when a slot selects its next row, human ordering ignores an earlier `execute_before`, or implementing this preference requires caller-authored/persisted generic priority;
- candidate ids cannot be scanned without mutation, more than one direct/human row is pre-claimed for a single worker slot, that slot selects another row before its claimed handler settles, or provider execution is deferred behind a batch of already-`running` commitments;
- a stale backlog can consume an unbounded drain, a non-starting candidate consumes `DRAIN_BATCH`, the count reflects scanned or claimed-but-not-started rows instead of executions actually begun, `approved_at` can disagree with its Approval transaction, or the separate per-invocation concurrency bound is violated;
- `DRAIN_BATCH` or the per-invocation in-flight bound is represented as a root-wide/global semaphore, or overlapping Fluid invocations are assumed unable to exceed it;
- a receipt-less ambiguous response becomes `failed` or `succeeded` instead of `outcome_unknown`;
- a commitment handler returns anything outside `accepted | rejected | unknown`, the dispatcher interprets provider HTTP/SDK details, or a generic catch maps an unexpected post-claim exception to `failed`;
- `accepted` settles without a receipt accepted by the registered `receiptSchema`, or an invalid/malformed receipt becomes `failed` rather than `outcome_unknown`;
- a connector returns `rejected` without provider-contract evidence that the operation was not applied, or maps timeout, network failure, response loss, or malformed response to `rejected`;
- the registry builds a direct/human kind without the typed handler or `receiptSchema`, its `successSemantics` becomes executable provider-classification logic, or the dispatcher switch is not exhaustive;
- the stale classifier emits a result outside `unknown(code, message)`, or Result Action discriminator, task status, task error projection, and charge are derived from different classifications;
- a Result Action can commit without the matching terminal task transition, or a commitment can become `succeeded`, `failed`, or `outcome_unknown` without its linked Result Action;
- an asynchronous stable receipt is reported as the eventual provider effect rather than acceptance of the command;
- a commitment declaring verification can settle accepted without atomically creating/observing its first same-root direct/automatic poll, replay can create more than one first occurrence, or that poll's key is not stable from Result Action, kind, and check number;
- a model/payload chooses a verification kind, provider lookup id, cadence, or deadline; a poll uses eve/LLM/agent credits; or a provider without durable lookup is presented as finally verified;
- a `pending` poll fails to settle itself as technically `succeeded` and atomically create/observe exactly one next occurrence after releasing its active identity, `completed`, provider-domain `failed`, or provider-domain `unverified` fails to settle the poll task technically `succeeded`, or any terminal provider observation creates a successor;
- a `pending` Verification requests Plan advancement; a terminal Verification for a qualifying Plan-derived commitment cannot attempt ADR-021's distinct post-commit wake-up; that attempt uses the poll row as Plan origin, accepts a caller-authored causal id, fails to validate the exact Verification/poll/Result/commitment links, reuses the commitment's earlier signal identity, propagates Intent/Plan authority to the poll, or can roll back the Verification settlement;
- deadline evaluation happens after a missing-capability gate and can therefore leave a poll queued forever, a deadline does not record `unverified(deadline_reached)`, or an exhausted row does not deterministically choose `technical_exhaustion` before deadline classification;
- a provider-outcome Verification Action does not link both its originating Result Action and poll task, or provider job failure automatically contests an analytics Decision;
- two provider-outcome Verification Actions can reference one poll occurrence, either Action link can cross brands, a poll subject is not Result-scoped, or replay recomputes timing from the current wall clock;
- v1 correctness depends on a provider webhook, public callback route, webhook retries, or an unpersisted early event instead of the durable poll task;
- an expired task starts a new provider call;
- independently created proposals are coalesced by semantic target/payload dedup, or v1 silently adds alias-key guarantees it does not store;
- two serialized commitments with the same brand and conflict key can both become `queued | running`, a losing approval still commits its Approval Action, or `target_busy` silently schedules later execution;
- the model or request payload supplies `commitment_conflict_key`, inverse kinds derive different keys for the same target, or an independent/commutative kind occupies the serialized slot;
- a serialized asynchronous pair is enabled even though acceptance is neither effect-final, provider-linearized, nor protected by a conditional/versioned state transition;
- two concurrent approvals for one conflict key can commit, an approval cannot report its blocking task, different brands or keys conflict, or cancellation/settlement auto-approves a previous loser;
- claim does not re-derive the persisted key from the registered final payload, an edit is approved using a key derived from an earlier revision, or a breaking conflict policy reinterprets pending rows under the old kind;
- a dismissed exact payload is recreated without an explicit reopen Action, or a superseded task remains approvable;
- a breaking executor change reinterprets an old pending payload instead of using a new kind or `needs_regeneration`;
- deletion of a brand leaves internal brand-scoped tasks or Actions, or attempts provider cleanup as part of the delete transaction.

## Consequences

- One approval has one execution owner and one durable task identity.
- Stateful non-commutative commitments cannot overlap on the same registered target; v1 rejects a conflicting click instead of promising a FIFO it does not implement.
- Agents can prepare useful provider-native drafts without gaining publish, schedule, send, spend, or cleanup authority.
- External failure handling is deliberately conservative: ambiguous work stops for a human rather than becoming an automatic duplicate.
- Dispatcher throughput is bounded without parking pre-claimed commitments: each invocation slot owns one claim-through-settlement sequence, `DRAIN_BATCH` counts starts, and the application makes no false global-concurrency promise across Fluid invocations beyond Postgres claim correctness.
- Billing is equally evidence-based: only stable provider acceptance is charged; ambiguous effects remain unbilled even if later evidence suggests they happened.
- The approval inbox is a task projection; batch approval stays an independent per-item UI operation.
- Provider account changes and provider-side edits do not trigger a second approval protocol in v1.
- Organization-membership and role changes do not retroactively revoke a committed Approval Action; an explicit pre-claim cancellation is the revocation mechanism.
- The task schema carries more terminal outcomes, but no Proposal table, batch table, external-attempt table, task-request alias ledger, generic pending-provider state, provider-event inbox, or runtime-version archive is introduced.

## Alternatives considered

- **Separate Proposal Object plus execution task** — rejected: it duplicates identity and settlement for no v1 capability. A pending direct task already has the required payload, lifecycle, owner, and audit links.
- **Resume an eve-approved tool after the click** — rejected: it gives the same commitment two possible executors and keeps external correctness inside a model session.
- **Automatically allow pause, unpublish, cancel, or close** — rejected: every external commitment uses the same human button; “safe direction” is not a separate authority path.
- **Lease and three automatic claims for provider writes** — rejected: the database cannot distinguish “provider applied it, response lost” from “nothing happened”.
- **Pre-call marker followed by safe requeue** — rejected for v1: a persisted marker does not prove that HTTP began, and `running -> queued` lets a late old worker collide with a new claim unless every update and effect is fenced by a claim generation. The conservative claim boundary trades occasional false `outcome_unknown` for a monotonic lifecycle with no automatic duplicate call.
- **Pin the provider account and reapprove on any external drift** — not adopted: the click authorizes the current registered provider operation. Users own account switches and provider-side edits made before clicking.
- **Semantic proposal deduplication or `task_request_keys`** — not adopted: exact creator replay, explicit supersession, and exact dismissal memory cover the required v1 cases without alias machinery.
- **Per-target FIFO of approved commitments** — rejected for v1: a conflict is returned to the human instead of silently pre-authorizing a sequence, and provider-side asynchronous ordering would still require an explicit contract.
- **Provider webhooks for eventual outcome** — deferred: without a durable event inbox, signature/replay handling, and correlation for events that beat receipt persistence, webhook correctness is provider-specific machinery. V1 polls from the durable receipt through the existing task queue, following the current CRM's polling-first precedent.
- **Clean up provider drafts during brand deletion** — rejected: internal deletion is transactional; cross-provider garbage collection is not. Orphaned external resources are accepted.
