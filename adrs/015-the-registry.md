# ADR-015 — The registry: uniform agent shape, two-declaration deltas, self-copies, tool composition, task kinds, capability gating, the console as consumer

**Status:** Accepted — 2026-08-06
**Amends:** ADR-006 (what the shared definition contains), ADR-012 (the return contract is eve's `outputSchema`)
**Amended by:** [ADR-017](017-consultative-subagents-durable-root-work.md) (D1–D6: capability-asymmetric modes, self-copy inheritance, tool composition, durable task entry, and capability gating)
**Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) (D3/D5: agent task kinds execute once in task mode, self-copy settlement is root-only, and completion is staged through `TaskCompletion`)
**Amended by:** [ADR-019](019-human-approved-external-commitments.md) (D4–D6: closed preparation/commitment variants, human activation, one-shot external direct execution, and preview/policy derivation)
**Amended by:** [ADR-020](020-typed-decisions-and-impact-verification.md) (D4–D6: Decision tools recommend only; Growth owns a registered one-shot agentic impact kind and exact-Intent preauthorization selection)
**Amended by:** [ADR-021](021-plan-advancement-and-human-readiness-override.md) (D5: current-Plan advancement is a separate registered CMO kind)
**Refs:** ADR-004, ADR-009, ADR-011, ADR-013; Eve 0.31.3 bundled docs (`agent-config.md`, `subagents.mdx`, `extensions.md`, `schedules.mdx`, `concepts/default-harness.md`, `concepts/sessions-runs-and-streaming.md`, `concepts/execution-model-and-durability.mdx`); [Vercel AI Gateway Custom Reporting](https://vercel.com/docs/ai-gateway/capabilities/advanced-reporting)

## Context

Grilling round on `packages/agents` — the last big contract not yet opened. Grounded in eve's actual subagent mechanics, which settled several questions by themselves: declared subagents inherit **none of the parent's authored slots or agent config** (absent slots fall back to framework defaults), channels are root-only, and a subagent's tool surface is `{ message, outputSchema? }`. Eve still propagates trusted session auth and parent lineage into the child; those framework contexts are not authored configuration. ADR-009 subsequently fixed the deployment shape: the CMO and six durable specialist roots are seven standalone eve apps, not one multi-agent mount, and scheduling is a Next.js cron poke rather than an eve schedule.

## Decisions

### D1 — Uniform shape: the CMO is a registry entry too

Uniform identity remains, but authority is explicitly mode-shaped. ADR-017 D5 owns the normative registry contract: a specialist entry is composed as `{ shared, consultation, durable }`, with common identity/instructions/model defaults in `shared`, read-only subagent capabilities and `ConsultationReturn` in `consultation`, and root work tools, connections, task kinds, egress and `TaskCompletion` in `durable`. The CMO remains a registry entry with durable task kinds and declared consultation targets. One loader generates the console projection and every wrapper; there is no flat union of tools or connections and no hand-built second definition.

### D2 — The two declarations share a core and differ in three declared deltas

The declarations share identity, core instructions, skills, and model defaults, but differ mechanically in authority, tool/connection surface, contract, lifecycle, and deployment. The subagent is read-only consultation inside `agent-cmo`; the standalone root is durable task execution. Eve's caller-selectable `outputSchema` is a consultation result contract, never an authorization boundary or the durable `TaskCompletion` contract. ADR-017 owns the exact per-mode composition; ADR-018 owns root settlement.

The materialization step generates the specialist's local consultative definition inside `agent-cmo` and its durable wrapper inside that specialist's standalone root app from one entry. It also mounts their explicitly selected workspace extensions. Reusable skills, tools, connections, instruction fragments, and hooks may live in those extensions; agent config, sandbox, schedules, and custom channels stay in the generated local wrapper because eve extensions cannot provide them. Consequently every model-bearing generated wrapper explicitly calls the shared `packages/agents` model-config factory, which resolves the model/window, preserves existing provider options, and injects trusted AI Gateway attribution. The shared audit/billing extension is not an optional capability selection: materialization mounts it in every root and explicitly inside every declared subagent. Eve isolates declared-subagent hooks and model config from the parent, so a root-only mount/config cannot observe or tag the child's `step.completed`; built-in self-copies are different and inherit both the root hook registry and model config without a second mount or factory call.

### D3 — Self-copies are intra-session parallelism, enabled uniformly

> **Amended by ADR-017 and ADR-018.** A CMO copy inherits the same two mechanisms as the CMO: non-deduplicated read-only specialist consultation and the authored durable-work tool. There is no pre-delegation subagent guard. Concurrent durable requests coalesce at the Postgres task constraint. A specialist-root copy remains inside the same dispatched task and inherits every work capability except task settlement authority. `finishTask` may remain visible, but its deterministic execute guard rejects any child for which `ctx.session.parent` is present with `FINISH_TASK_ROOT_ONLY`; only the top-level root session may stage `TaskCompletion`. The parent gathers child results and candidate deliverables, selects the final `output_object_ids`, then calls `finishTask` itself. No copy widens authority.

The built-in `agent` tool does not spawn independent agents — it is a tool the agent calls inside its own session, and the copy runs as a child of an already-dispatched, already-budgeted, already-traced session. There is no queue to bypass: **the queue governs parallelism across work items** (N tasks → N dispatched sessions), while **self-copies govern parallelism within one work item** (a specialist analyzing ten URLs in parallel during one audit; the CMO running research fan-out or a `marketing-council` deliberation).

- Enabled on the CMO and on specialist roots alike — one rule, no special cases.
- Eve's mechanical bounds apply everywhere: copies cannot call `agent` recursively, and copies share the parent's sandbox, so every agent's instructions require non-overlapping write scopes.
- Specialist copies are **leaf parallelism by construction**: no nested subagents are authored, so a specialist copy has nothing to delegate to.
- Specialist-root copies retain the parent's graph writes, scheduling, lateral enqueue, and registered preparation tools, but not its authority to settle the task. This carve-out is enforced inside `finishTask.execute`, not by prompt wording or required dynamic tool omission. A future omission from the child-visible surface may improve UX, but cannot replace the execute guard.
- Budget attribution rolls up the session tree: every child-session **billable `step.completed`** creates its own `model_charge` against the same trusted brand pool (ADR-014 D5), and the pool check gates new **agent-session** work at dispatch (ADR-011 D4). Eve propagates the parent session's `auth.initiator`/`auth.current` into both self-copies and declared subagents; the audit hook takes `brand_id` from the trusted initiator, requires the current value to match, and persists the child's immediate/root lineage from `ctx.session.parent`. Raw compaction lifecycle events are persisted at their emitting depth but create no charge: Eve exposes no compaction `step.completed` or authoritative provider usage/cost/generation id. This requires neither a child-session mapping table nor a parent-stream observer. It is not a generic gate on deterministic direct claims.
- Gateway reporting follows the same tree but through agent config rather than the audit hook. Each root and declared subagent's generated wrapper calls the shared model-config factory; self-copies reuse their root config. The factory reserves `gateway.user = brand_id` plus the registry-derived agent/feature/lane/environment tags and explicitly merges all pre-existing provider options. Those active-model options remain on zero/N-call automatic or manual compaction, allowing Custom Reporting to measure attributed Branderize platform overhead. Reporting remains best effort; the winning local `model_charge` is authoritative for billable application charges/admission, not total Gateway spend, and the difference is never converted into credits by estimation, lookup, instrumentation, fork, or reconciliation.

### D4 — Tool composition is mechanical from the registry

> **Amended by ADR-017 and ADR-019.** The former flat common-tool set is no longer current. Registry generation produces `consultTools` (brain reads and allowlisted external reads) for declared specialists and `workTools` for standalone roots. Root work tools include brain writes, scheduling/lateral enqueue, preparation of human-activation tasks, and only explicitly registered create-only external drafts. Every external-draft operation declares replay semantics as `idempotent`, `recoverable`, or `duplicate-safe`; materialization rejects an unclassified operation. External commitment handlers are plain-code direct executors and are never placed on a model-visible tool surface.

Because declared subagents inherit no authored parent slots implicitly, each generated declaration must compose every required capability and config either locally or through an explicit workspace-extension mount. Propagated auth and parent lineage remain framework context and are not copied through the registry:

- `workTools` (every durable agent, further narrowed per entry): `get_brand_context`, `produce_object`, `recommend_decision`, `record_evidence`, `schedule_recheck`, … `record_evidence` accepts closed Evidence variants including provider-independent `metric_observation`, derives brand/Actor/task/session from trusted context, atomically writes its Action + Evidence Object, and returns the Object id; value, source and interpretation are model-authored. `recommend_decision` validates and persists an ordinary `report:decision_recommendation` Object and returns its id; it is not a pending Decision or authority grant. Active v1 Decisions have no model-visible recording tool; only the authenticated human `recordDecision` boundary may reload and canonicalize that exact report.
- `specialistTools[slug]`: the specialist's authored tools
- `connections[slug]`: MCP connections with per-connection tool allowlists

The registry selects these contributions and their mode-specific grants; workspace extensions distribute their reusable implementations without becoming the authority model. Extension mounts are namespaced, while additive hooks and instruction fragments are reviewed as part of the generated declaration. Root-only dispatch channels, schedules, sandboxes, and `agent.ts` configuration are never hidden inside an extension.

An agent physically lacks tools outside its entry. Combined with ADR-013 (writes only via app-runtime tools), "every boundary action passes through the Policy" becomes: the Policy knows every tool that exists, because it assigned them.

### D5 — Task kinds are first-class registry citizens

> **Amended by ADR-017, ADR-018, and ADR-019.** Task kinds describe durable root work and deterministic commitments. Agent-mode behavior remains the one-shot eve protocol below. Direct kinds now declare activation and execution policy. The bounded-retry `direct/automatic` lane is restricted to retry-safe deterministic operations: transaction-safe internal mutations or side-effect-free idempotent external reads, never external writes. Human external commitments begin in `awaiting_approval`, require an Approval Action, and make one deterministic provider call without lease reclaim.

```text
{ kind, workerKey, executionMode: agent | direct,
  activation: automatic | human,
  briefSchema (zod, kind-specific payload),
  outputContract (producible Object types),
  completionResultSchema (zod, kind-specific result or z.null()),
  requiredOutputObjectIds: (validatedResult) → ObjectId[],
  subjectKey: (payload) → string,     // the dedup key (ADR-014)
  acceptsPlanRouteOrigin?: true,      // initial or derived trusted Plan work
  recheckKind?: RegisteredTaskKind,   // sole scheduleRecheck target (ADR-017)
  modelOverride?, budgetClass,        // soft per-task work budget, not an eve limit
  requires: capability[],             // see D6
  effectPhase?, effectClass?,         // trusted Policy inputs (ADR-019)
  preview?, directHandler?,           // direct/automatic only
  verificationPoll?: {                // direct/automatic, read-only only
    readHandler,                       // idempotent provider lookup
    resultSchema,                      // pending | completed | failed | unverified
    nextDueAt: (checkNumber, result, observedAt) → Date,
    deadline: (receipt, acceptedAt) → Date
  },
  commitment?: {
    providerOperation, successSemantics, receiptSchema,
    handler: (context, payload) → Promise<CommitmentOutcome<Receipt>>,
    concurrency: { kind: independent }
      | { kind: serialized,
          conflictKey: (payload) → string,
          acceptedOrdering: effect-final | provider-linearized | conditional-state },
    verification?: {
      taskKind: RegisteredTaskKind,
      receiptKey: (receipt) → string,
      firstDueAt: (receipt, acceptedAt) → Date
    },
    billing: { billable: false }
      | { billable: true, priceKey, quote: (plan) → BillingSnapshot }
  },
  schedulableBy: readonly (agent | decision | human)[] }
```

Common `TaskCompletion.output_object_ids` are selected deliverables rather than the task's complete Object inventory. `finishTask` first validates the caller-selected ids as duplicate-free exact ids, then validates the kind-specific `result` and invokes the registered pure `requiredOutputObjectIds(validatedResult)` function. Every kind declares that function explicitly, including `() → []`. It canonicalizes the stored list as the sorted set-union of caller-selected and required ids. Every member of that union must be same-brand, have an `outputContract`-allowed Object type/subtype, and satisfy `Object.produced_by → Action.task_id = current trusted task`; a required id with invalid provenance fails staging, while merely omitting a valid required id from the model-authored list does not. The function derives principal outputs only from the already-validated result and performs no model call or external read. It is an explicit kind contract, never a generic scan of fields ending in `_object_id`: for example a published rebuild's Plan is a new output, while `advance-marketing-plan.result.plan_object_id` names its pre-existing input and is not. `finishTask` never requires equality with every task-linked Object.

The dispatcher validates kind payloads with `briefSchema` and derives subject, worker, mode, activation, and execution policy from the registered kind. `finishTask` validates the common `TaskCompletion` fields and its `result` against that kind's `completionResultSchema`; kinds without a business-specific result register `z.null()` rather than leaving an untyped escape hatch. For Intent-bound work, `packages/brain` separately composes the common `IntentSnapshot` envelope from the latest same-brand canonical Intent and only applicable active `intent_preauthorization` heads with `content.authorized = true`, whose producing Actions link that exact Intent. Roadmap, model and brand-restriction Decisions are consumed through their own registered selectors and never enter the preauthorization array. A task kind can receive a trusted Plan/Move origin—whether from initial Plan publication, a lateral edge, recheck, replacement, retry, or derived commitment—only when it declares `acceptsPlanRouteOrigin: true`; that branch persists exact trusted Plan/Move references with null Intent/snapshot and never selects preauthorizations. Registry materialization validates that every declared `recheckKind` and lateral edge reachable from a Plan-origin source targets a compatible kind. Registry payload schemas cannot accept an `intent_snapshot`, `intent_revision`, statement, criteria, constraints, preauthorization, Plan id, or common origin field that overrides either envelope. ADR-021's `advance-marketing-plan` is the sole narrow coordinator exception: dedicated trusted creators place the exact Plan and optional target Move in its closed payload while all common-origin columns remain null. Its creator/mode matrix is enforced outside generic enqueue: terminal signals and human **Ricontrolla** may create only `evaluate`, while only the authenticated human override transaction may create `human_override`; browser/model input cannot supply or switch that discriminator. The generated root validates the discriminated common origin plus its kind schema when reloading the task; a declared consultation receives no durable task origin unless it is later promoted through task creation.

The registry does not make Intent selection a generic agent capability. Only the top-level interactive CMO wrapper may accept a candidate `intent_id`, and only when the current authenticated human request identifies it without ambiguity; that id is not part of any task-kind payload. Generic task/autonomous tools accept no raw Intent selector and derive origin from their current task. After the interactive guard, the ordinary task service alone reloads active status, constructs the latest snapshot and applicable preauthorization facts, and returns the exact preserved Intent id/revision of the created or observed row.

A human-activation kind can be created only as `awaiting_approval`; generic enqueue cannot put it directly in `queued`. Its `commitment` block is mandatory and its preview, effect signature, connector method, handler, success semantics, stable-receipt schema, and concurrency policy come from the same entry, so a payload cannot smuggle an operation hidden from the approval UI or invent provider success. `CommitmentOutcome<Receipt>` is the closed `accepted(receipt) | rejected(code, message) | unknown(code, message)` union from ADR-019: the provider-specific handler classifies its own protocol, while the generic dispatcher only performs an exhaustive switch. `successSemantics` documents the accepted-command meaning and UI label; it is metadata, never a second HTTP/SDK classifier. Additive or otherwise proven-commutative operations declare `independent`. Stateful non-commutative operations declare `serialized` and derive one trusted `conflictKey` shared by inverse kinds on the same external target. If `succeeded` means asynchronous acceptance rather than a completed effect, registration also requires an honest ordering contract: provider linearization or a conditional/versioned state transition. Otherwise that conflicting async capability is not enabled in v1.

An accepted command needs eventual-outcome tracking only when its optional `verification` relation names one task kind owned by the same root, present in that root's `compiledSupportedKinds`, declared `direct/automatic`, and equipped with `verificationPoll`. Provider-outcome poll kinds are registered origin-free work: their task rows have null Intent/snapshot and null Plan/Move, evaluate Policy with `structure_level = null`, and derive provenance from the immutable Result Action they inspect. The first poll and every successor remain on that branch even when the originating commitment carried an Intent or Plan origin; they therefore do not require `acceptsPlanRouteOrigin`. The handler is a side-effect-free idempotent provider read: it cannot call eve, open a model session, consume agent credit, or make an external mutation. Its `subjectKey` is Result-scoped, for example `provider-verification:<result_action_id>`, so two accepted commitments can never observe the same active poll merely because a provider lookup id collides. The receipt extractor, initial due time, typed read handler, closed result schema, bounded cadence, and deadline are trusted code. `firstDueAt` and `deadline` derive from the persisted Result Action timestamp; `nextDueAt` derives from the persisted current-poll observation timestamp. They cannot read the wall clock implicitly, so exact-key replay receives the same canonical request. A valid provider observation is `pending | completed | failed | unverified`; provider-domain `failed` says that the external job failed, not that the polling code failed. Neither the model nor the commitment payload can select a poll kind, lookup id, cadence, or deadline. A provider without durable lookup leaves `verification` absent, so product success means command acceptance only.

Decision-impact measurement is a separate registered kind, not a `commitment.verificationPoll`: `verify-roadmap-decision-impact` is owned by `growth`, uses `executionMode = agent` and `activation = automatic`, accepts only `{ decision_id }`, derives its exact subject/idempotency keys from that immutable Decision Object, and is registered origin-free with null Intent/snapshot and null Plan/Move. At or after `Decision.content.impact.evaluate_at`, the ordinary one-shot Growth session may use any measurement read tools in its compiled surface and writes its current observation through `record_evidence`; no metric/provider adapter, query recipe or source-specific task schema exists. Its closed completion uses the common `TaskCompletion.status = 'completed'`, requires `intent_acceptance = null`, and adds `result.judgment = supported | not_supported` with current Evidence id and rationale, or `inconclusive` with rationale and optional Evidence. Its `requiredOutputObjectIds` returns that current Evidence id when present and otherwise `[]`; the semantic result validator still requires it to be the same-task `metric_observation` for every conclusive judgment. Normal agent settlement uses the Growth Actor, links one Verification Action to the Decision/task, never mutates an Intent, and may create one CMO reconsideration task only for an active `not_supported` head. It uses agent credit but no `next_*`, recurring schedule or `scheduleRecheck`.

That reconsideration is itself one closed registered kind rather than an implicit phrase:

```text
kind: decision-reconsideration
workerKey: cmo
executionMode: agent
activation: automatic
briefSchema: { decision_id, verification_action_id, origin_intent_id }
outputContract: { report: decision_recommendation }
completionResultSchema:
  | { outcome: recommended, report_object_id }
  | { outcome: obsolete, reason: decision_inactive }
requiredOutputObjectIds:
  recommended -> [report_object_id]
  obsolete    -> []
subjectKey: decision-reconsideration:<decision_id>
schedulableBy: [agent]
```

Only the trusted settlement of that exact Decision-impact kind may assemble this task; generic agent enqueue and model payloads cannot select it or author any id. The row is origin-free, while the three brief ids are exact immutable causal references derived by trusted code. Before producing a report, the CMO reloads the Decision head and validates that the historical origin still resolves as a same-brand non-draft Intent. Only an inactive Decision makes the task `obsolete`; settlement or abandonment of the origin does not invalidate a brand-wide Strategy. A `recommended` result must cite one same-task `decision_recommendation` report whose observed head, verification Action and non-null causal origin agree exactly with the brief. A later concurrent head transition may make an already-produced report obsolete, but never rewrites it; the human acceptance boundary always rechecks the head and causal references before writing.

Marketing Plan generation is another registered agent kind, not a direct compiler:

```text
kind: rebuild-marketing-plan
workerKey: cmo
executionMode: agent
activation: automatic
briefSchema: { strategy_decision_id }
outputContract: { evidence, move_candidate, marketing_plan }
completionResultSchema:
  | { outcome: published, plan_object_id }
  | { outcome: obsolete }
requiredOutputObjectIds:
  published -> [plan_object_id]
  obsolete  -> []
subjectKey: plan:<strategy_decision_id>
schedulableBy: [decision, human]
```

Trusted creators derive `strategy_decision_id` from the new or current active brand-wide `strategy` head. The creator allowlist deliberately admits both trusted paths: recording a new Strategy inserts or observes the initial task in the same transaction as that Decision, while the authenticated human Rebuild action creates a distinct request for the same kind. Neither path bypasses the registry. Active-work uniqueness coalesces simultaneous rebuilds for one Strategy, while a new request after terminalization may create another task. The CMO explores current active Intents, Evidence and Move Candidates during its run; none is copied into the queued task payload. `publishPlanAndRoute` accepts canonical exact Intent refs, revalidates them against one ordered read of all current active Intents, and stores trusted typed snapshots in the Plan-producing Action. Their role is planning provenance only. Its output contract deliberately permits the CMO to call `record_evidence` and create additional typed Move Candidates before the Plan, so a new brand does not require a prerequisite workflow. Each Evidence and candidate commits through the ordinary task-bound brain write with the CMO Actor and its own source/rationale; a candidate may cite only duplicate-free exact same-brand Evidence Object ids, never Evidence keys.

The final `publishPlanAndRoute` call accepts the canonical planning Intent refs plus only a bounded route list targeting registered `agent/automatic` kinds with `acceptsPlanRouteOrigin: true` that perform internal work or external preparation; direct/human commitments are not route targets. Registry materialization validates each target's exact payload, derives worker and the base subject, rejects any raw `subjectKey` value beginning with the reserved `plan-route:` prefix, then namespaces the active identity as `plan-route:<move_candidate_id>:<registered-subject>` and derives every remaining lifecycle field. It rejects duplicate derived route identities and canonicalizes the list before hashing or writing. The registered subject is the semantic equivalence contract: normal active-work identity may return an existing task only when that row has the same kind and derived subject, is non-Intent-bound, and carries the same Move reference; a different Move, Intent-bound row, or unscoped manual row is an incompatible conflict that rolls the publication back. The atomic routing Action records whether each route created or observed its result plus a nullable immutable root-routing Action/task pair. A created root points to the current Action/task; an observed row retains that pair only if an earlier Plan/wave `created` mapping originally materialized it. Observed task rows and their original Plan, parent, payload and provenance remain untouched; an observed lateral descendant therefore has no root pair. After complete validation, the same transaction may settle only exact queued root wave routes selected by `excluded_moves`: candidate ids come from non-null root mappings in the old Plan-producing and later wave Actions, while the guarded predicate rechecks lane/status, null Intent, exact Plan/Move origin, absence of retry/replacement/schedule lineage, the recorded original parent, and the origin Action's `created` mapping. Guarded updates run in stable task-id order and the Plan Action records the exact returned ids per Move. Any later publication failure rolls those settlements back with the Plan and newly routed tasks. Plan persistence first locks the authoritative running rebuild task, then the exact active Strategy and current Plan head, validates one ordered active-Intent snapshot plus every selected route before writing, and commits the producing Action, Plan supersession/Object, exclusion settlements, and all newly created tasks together. A planning-ref mismatch returns `planning_inputs_changed` for reload/retry with no write. `published` requires that exact Plan and complete selected-route result; it does not claim that application code proved the model's routing semantically exhaustive. `obsolete` is accepted only after trusted settlement reconfirms that the task's pinned Strategy is no longer active. A Plan-head `stale_head` is a retriable write conflict inside the still-current run, not a completion result. The task uses the normal agent-credit gate and never runs model intelligence in the console route.

Progress through an already-published Plan is a different registered agent kind:

```text
kind: advance-marketing-plan
workerKey: cmo
executionMode: agent
activation: automatic
briefSchema:
  | { mode: evaluate, plan_object_id }
  | { mode: human_override, plan_object_id, target_move_candidate_id }
outputContract: { evidence }
completionResultSchema:
  | { outcome: advanced, plan_object_id, wave_action_id }
  | { outcome: no_ready_moves, plan_object_id, wave_action_id }
  | { outcome: obsolete, plan_object_id }
  | { outcome: blocked, plan_object_id, target_move_candidate_id, trusted_code }
requiredOutputObjectIds: (_validatedResult) -> []
subjectKey:
  evaluate       -> plan-advance:<plan_object_id>:general
  human_override -> plan-advance:<plan_object_id>:move:<target_move_candidate_id>
schedulableBy: [agent, human]
```

Only dedicated trusted application creators assemble that brief; generic enqueue rejects it. A terminal source signal may create only `evaluate`. Its non-locking preflight derives the candidate current Plan and stable creator key from the exact source. The transaction takes that creator-key advisory lock and first returns or hash-rejects any task receipt already inserted by it. Only on a receipt miss does it take the general `(brand, candidate Plan, general)` advisory lock, hold that candidate Plan `FOR SHARE`, recheck that it is still the current head and that its Strategy plus planning Intent refs still match current heads, and accept either a source mapped `created | observed` by that Plan or a source whose immutable `parent_task_id` chain reaches the first such mapped ancestor. A Plan requiring Rebuild creates no coordinator. A cycle-safe, non-locking traversal requires source through anchor to share brand, null Intent/snapshot, and the exact same non-null origin Plan/Move pair; it never trusts that origin Plan alone, because the current Plan may be a newer head that adopted the anchor. Human **Ricontrolla** may create only `evaluate`; `human_override` may be inserted only with `plan_move_readiness_overridden` in the authenticated human transaction, and both human creators apply the same Plan-needs-Rebuild guard. Under the retained Plan lock, signal creation performs only a plain non-locking read of any queued/running general task. It returns `advance_in_progress` when one is visible, without an alias or receipt for this signal; otherwise it inserts under the partial active-identity unique guard. It never waits for or locks the source, ancestors, or an existing advancement task while holding the Plan. This serializes against Rebuild's `FOR UPDATE` on the head without inverting the running advancement's `task → Strategy → Plan` order. The coordinator is origin-free and uses the null-structure Policy branch; ancestry grants no route, root provenance, readiness fact, preauthorization, or withdrawal authority. Tasks the coordinator routes must still declare `acceptsPlanRouteOrigin: true`. General and targeted subjects never coalesce. A repeated request for the same active subject returns `advance_in_progress` without pretending to persist a second request. `advancePlanAndRoute` reuses the registered route validation and `plan-route:<move>:<subject>` identity but appends a non-producing wave Action instead of a Plan Object. Human override mode restricts every route to its target Move, requires at least one route, and cannot return `no_ready_moves`; `finishTask` accepts `blocked` only after trusted code re-derives its closed registry/capability failure code. One subtype-unique wave Action is allowed per advancement task.

“First” above means first application after the operation-key advisory lock and producing-Action receipt lookup miss. Exact same-hash replay returns the committed Plan/route/exclusion receipt before any current task or head guard; same key with a different hash fails.

Plan dependency edges are not registry edges and never become claim predicates. Both routing boundaries accept only the CMO-selected ready-now wave: registry materialization validates each requested kind/payload/origin and cannot infer whether the whole roadmap is ready. The dispatcher sees ordinary registered task rows and ignores `dependency_move_candidate_ids`. A later `advance-marketing-plan` evaluation can create another wave on the same Plan. Its automatic signal is best-effort; the human **Ricontrolla** and targeted **Avvia comunque** paths provide explicit recovery without becoming registry edges or external-effect approval.

The billing branch is exhaustive: non-billable is explicit, while billable requires a stable `priceKey` and a trusted quote function. Approval persists the resolved `BillingSnapshot { price_key, pricing_version, currency, unit_amount }`; settlement never consults the live price table. V1 action pricing is a fixed unit amount per approved operation. Any variable external spend or blast-radius limit is a separate Policy `cost_bound`, not the Branderize `action_charge`. A kind that permits follow-ups has exactly one same-root `recheckKind`; human external commitments never use that successor mechanism.

Materialization derives a static `compiledSupportedKinds` set for every root. Its claim filters `worker_key = SELF AND kind IN compiledSupportedKinds` before any lifecycle mutation; mode plus activation then selects the one-shot agent lane, bounded-retry direct/automatic lane, or human external-commitment lane inside that responsible root. A queue row created by newer producer code but unknown to an older root build is never routed to a generic handler. Before support for a human commitment kind is removed, its unexecuted rows are terminalized as `needs_regeneration` or the old handler remains until they drain.

Once published, the common task-origin/`IntentSnapshot` schemas and a kind's `briefSchema`, `acceptsPlanRouteOrigin` declaration, output contract, `completionResultSchema`, `requiredOutputObjectIds` derivation, ownership, execution semantics, concurrency classification, conflict-key derivation, accepted-ordering contract, and verification relation/poll contract evolve only backward-compatibly. Changing a poll's receipt extractor, lookup schema, result interpretation, cadence, or deadline semantics is breaking unless the old queued payloads remain valid. A breaking kind contract receives a new kind, or follows an explicit expand-contract rollout: deploy consumers that accept old and new shapes, begin producing the new shape, let old rows drain, then remove legacy support. The common origin envelope follows the same expand-contract discipline across every producer and root. V1 stores no per-row `contract_version`, no `intent_versions`, and coordinates no global deployment barrier.

### D6 — Capability gating at the finest grain: task kinds and tools, never whole agents

> **Amended by ADR-017.** Durable task `requires[]` and root work-tool gating remain as written. Declared specialists receive only capability-bound read operations; missing capabilities omit those reads and surface the corresponding brand-connection requirement, while effectful connection operations are never present in the consultative manifest.

Gating a whole specialist on a missing connection is the wrong granularity (`lifecycle` does churn analysis with no connection and newsletters with Resend). Two fine grains instead:

- **Task kinds** declare provider and product `requires[]`; the dispatcher normally checks them before claim — unmet requirements leave the task queued and the console counter shows "N jobs waiting on Resend" (ADR-009). Provider Verification polls have one narrow ordering exception: exhausted-attempt retirement runs first, then the registered deadline is checked, and only then are `requires[]` evaluated. Decision-impact measurement declares no provider-specific requirement because Growth may choose among any available measurement tools; if none can support a comparable observation, the running agent may conclude `inconclusive`. Autonomous AI-credit balance is not a generic `requires[]`: it gates agent-session claims including Decision-impact work, while deterministic provider Verification polls and valid direct/human commitments bypass it.
- **Capability-bound tools** are `defineDynamic` per session: a missing read or registered create-only draft capability omits it from the session surface. The console may offer a connect link, but it starts an authenticated `apps/app` onboarding flow that assigns the grant to the brand; it is not Eve's user-scoped interactive OAuth inside the agent turn. Brand connection consent remains separate from approval of a commitment task. Publish/send/activate/spend/pause/delete methods are never dynamically granted to the model.

The registry declares the universe (code); per-brand enablement is data (a projection over Decisions + connected capabilities).

### D7 — The console is also a registry consumer

`apps/app` imports the registry for the team page (roster, owns, skills), capability counters, policy-UI categories, and the plan page. Therefore `packages/agents` is isomorphic: no Node-only APIs at import time (zod schemas are fine). One source feeds the CMO's six consultative declarations, the six standalone durable wrappers plus the CMO root, all seven root dispatchers, their workspace-extension mount lists, and the console UI. Build verification rejects a root or declared-subagent wrapper that omits the mandatory audit extension or shared model-config factory; it also rejects a generated self-copy-only duplicate mount/config. Contract fixtures reject any Intent-bound producer or root that accepts a caller-authored common snapshot, skips the shared `IntentSnapshot` validation, duplicates an overriding snapshot field inside its kind payload, or reinterprets an old queued task through the current Intent row. Eve end-to-end fixtures, rather than only manifest snapshots, must prove one correctly attributed winning charge and the expected Gateway `user`/tags for a root step, a built-in self-copy step, and a declared-subagent step. A merge fixture proves attribution cannot clobber routing, service tier, caching, reasoning, or provider-native options.

## Notes

- Redeploys change a standing human CMO conversation at its next turn. A one-shot agent task uses the root deployment that accepts it; Branderize does not pin an immutable agent version in the database. This remains consistent with the rejected `skill_snapshot` (ADR-011): code is code.
- Subagent names live in the same namespace as tool names; a collision is a build error. Naming convention: specialist slugs stay distinct from tool names.
