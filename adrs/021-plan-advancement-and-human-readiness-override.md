# ADR-021 — Plan advancement and human readiness override

**Status:** Accepted — 2026-08-12
**Deciders:** Tommaso, architecture grilling with three independent reviews
**Amends:** ADR-010 (rebuild versus advancement), ADR-011 (Plan progress), ADR-012 (routing boundary), ADR-014 (Plan-route provenance), ADR-015 (registered task kind), ADR-017 (durable routing), and ADR-018 (one-shot lifecycle)
**Builds on:** immutable Marketing Plan Objects, Action provenance, typed task routing, organization-wide Member authorization, and the human gate for every external commitment.

## Context

The earlier wording treated every later Plan wave as a **Rebuild**. That conflated two different operations:

- changing the roadmap synthesis or the active-Intent portfolio it coordinates, which must create a new immutable `marketing_plan` Object and supersede the old head;
- progressing through an already-published roadmap, which needs fresh CMO judgment and more work rows but must not create a fake Plan version.

Move dependencies remain informative rather than dispatcher predicates. The CMO can therefore judge that no additional Move is ready even when a human knows otherwise. V1 needs a narrow human escape hatch without introducing a workflow DAG, mutable Move status, a wave table, or authority to bypass normal execution controls.

## Decision

### D1 — Rebuild changes the Plan; advance changes only its execution frontier

`rebuild-marketing-plan` creates a new Plan version. It may change priority, dependencies, assumptions, inclusions, or exclusions; successful `publishPlanAndRoute` supersedes the previous Plan Object and may also create its initial ready-now wave.

`advance-marketing-plan` operates against one exact, still-active immutable Plan whose pinned Strategy and planning-Intent revisions still match the brand's current heads. It asks the CMO which registered internal or preparatory work should start next. Successful advancement appends a `plan_wave_evaluated` Action and creates or observes the selected tasks atomically, but creates or supersedes no Object and changes no Plan content. The initial wave is recorded in the Plan-producing Action; every later wave is recorded in its own Action. Those Actions plus task states are the Plan's progress projection, so v1 needs no `plan_waves` table or mutable Plan cursor.

### D2 — One registered CMO task owns general and targeted advancement

```text
kind: advance-marketing-plan
workerKey: cmo
executionMode: agent
activation: automatic
trusted brief:
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

The Plan and optional Move ids are a narrow trusted coordinator payload: the model and browser never supply the final task envelope, worker, mode, activation, common origin, or subject. Creator authority is a mechanical mode matrix despite the kind-level `schedulableBy` union: an ordinary terminal-task signal or a terminal provider-outcome Verification signal may create only `evaluate` and derives the current eligible Plan from either direct route adoption of its trusted eligibility source or that source's qualified immutable ancestry to an adopted task; human **Ricontrolla** may create only `evaluate` after a current-head check; `human_override` may be created only by D4's authenticated human boundary in the same transaction as its human Action. Generic enqueue rejects this kind/mode combination outside those dedicated creators. The coordinator task itself is registered origin-free (`intent_id`, snapshot, Plan/Move columns all null) and evaluates Policy with `structure_level = null`; its payload pins the Plan it must inspect. Tasks routed by it use the existing Plan-route branch with the exact Plan/Move pair, null Intent, and the advancement task as parent.

A general and a targeted task use different active identities and may coexist. Repeated general requests, or repeated targeted requests for the same Plan/Move, return `advance_in_progress` while their corresponding task is queued or running; they do not append a misleading second request Action. A targeted human override therefore cannot be swallowed by an unrelated general evaluation.

### D3 — Automatic advancement is best-effort in v1; the console is the recovery path

When ordinary Plan-routed work reaches a terminal application state, that terminal settlement commits first. Only afterward, a separate fire-and-forget best-effort attempt passes the exact source task id to its dedicated creator. This includes terminal agent work and Plan-derived commitment outcomes. A provider-outcome poll remains origin-free and a `pending` observation never signals. When such a poll instead commits a terminal Verification, a second dedicated post-commit path accepts only that internal `verification_action_id`, treats the immutable Verification as a new event, and revalidates `Verification → its poll task → accepted Result Action → succeeded direct/human commitment`. It uses that commitment only as the eligibility source for the same Plan-adoption/ancestry checks; the poll task is never traversed or reclassified as Plan-routed. The ordinary creator key is scoped by terminal source plus candidate Plan. The provider-final key is separately scoped by exact Verification Action plus candidate Plan, for example `plan-advance-provider-final:<verification_action_id>:<candidate_plan_id>`, so it cannot replay the evaluation already requested when the commitment was merely accepted.

For either trigger shape, a non-locking preflight obtains the eligibility source brand and a candidate current Plan and derives the exact event-specific creator key. For provider-final work the canonical creation hash covers the trigger discriminator, Verification, Result, derived commitment, candidate Plan, `mode = evaluate`, and the derived coordinator payload; `call_id` or poll timing is not identity. The creator transaction first takes that creator-key advisory lock, then looks up and hash-validates any task previously inserted by that key: an exact hit returns its historical receipt immediately, while same-key/different-hash input fails. Only on a receipt miss does it take the advisory lock shared by every dedicated general creator for `(brand, candidate Plan, general)`, lock that exact Plan row `FOR SHARE`, and reconfirm under the retained lock that it is the active head and `plan_needs_rebuild = false`. For a provider-final event it also reconfirms the terminal Verification and exact same-brand Verification/poll/Result/commitment links under this first application; caller/model/browser input cannot author any member of that chain. The source qualifies at depth zero when the Plan's producing or wave Action maps it `created | observed`; otherwise a cycle-safe plain traversal follows immutable `parent_task_id` only until the first ancestor with such a mapping. Every row from source through anchor must have the same brand, null Intent/snapshot, and the exact same non-null origin Plan/Move pair, and the mapping must associate the anchor with that Move. The origin pair may name P1 while the locked current P2 adopted the anchor. If the Plan requires Rebuild or no anchor qualifies, the creator writes nothing. If a Rebuild won first, the creator releases/rolls back and may retry against the new head; if the signal wins the Plan lock, that Rebuild waits until this short transaction commits. A signal valid at its planning-input validation point may later become `obsolete` after a Strategy/Intent change or Rebuild; v1 does not add a brand-wide lock across every Intent mutation. This is different from inserting against a Plan already stale when checked.

The immutable task row's `plan_object_id`, `move_candidate_id`, and `parent_task_id` remain original provenance and are never rewritten to manufacture eligibility. Every newly inserted task-bound descendant gets its existing source as parent; an observed or rescheduled row keeps the parent it already had and qualifies only if that preserved chain reaches an adopted anchor. The ordinary stable creator key is scoped by the exact terminal source and candidate Plan (for example `plan-advance-signal:<source_task_id>:<candidate_plan_id>`); the provider-final key uses the Verification Action instead, while deriving the same commitment source only for eligibility. After the receipt miss and current-Plan validation above, the creator uses plain non-locking reads for immutable ancestry/mappings and for the general queued/running identity. If one is visible, it returns the ordinary absorbed/`advance_in_progress` outcome without aliasing the request; if none is visible, it inserts under the active-identity unique backstop. All valid general creators honor the same advisory lock, so this branch never waits for or locks the source, ancestors, poll, Verification, or an advancement task while owning the Plan. If P1 created an unfinished anchor and P2 later observed it, the anchor or any qualifying same-origin descendant can therefore attempt advancement for P2 without rewriting P1 provenance. A current Plan that adopted no ancestor receives no signal. The ancestry authorizes only creation/observation of the origin-free general evaluation; it does not map the descendant, assign root origin, prove readiness/completion, widen Policy, or make it withdrawable. If the signal inserted the task, exact same-key retry returns its historical receipt before current Plan or ancestry checks; if it merely observed another active evaluation, v1 deliberately stores no alias and retains the documented liveness semantics. This post-commit attempt never holds the source-task or poll settlement lock, cannot roll back or alter the settled task/Verification, and reports enqueue failure only through telemetry. A crash before the attempt remains the explicitly accepted best-effort gap.

Normal active-work dedup intentionally stores no alias for a request that merely observed an existing task. A signal arriving after an active advancement has read the graph but before it terminates can therefore be absorbed and lost. Likewise, a lateral/recheck/commitment request that merely observed or rescheduled an existing row does not create a new parent edge; if that row's preserved ancestry reaches no current-Plan adopted anchor, its terminal state cannot signal automatically. V1 accepts these narrow liveness gaps instead of adding an outbox, dirty bit, mutable cursor, observed-from edge, or dependency engine. The Plan UI exposes **Ricontrolla**; once the general task is terminal, a current non-viewer human authorized by ADR-001 can create a fresh evaluation. While it is active, the command returns `advance_in_progress` and the user can retry afterward.

### D4 — `Avvia comunque` overrides only the CMO's readiness judgment

The Plan UI also exposes **Avvia comunque** on an included Move. Its typed application boundary:

1. resolves the Plan brand and locks the current Better Auth Member `FOR SHARE`, requiring `owner | admin | member`;
2. resolves the global human Actor, acquires the namespaced operation-key advisory lock, and looks up/hash-validates the Action receipt;
3. returns an exact same-hash historical receipt before any current Plan/Move guard, while same-key/different-hash fails;
4. only on a receipt miss locks and verifies the exact active Plan head and same-brand included/non-excluded Move, evaluates current Policy, and creates the targeted task;
5. appends one human `plan_move_readiness_overridden` Action in that same transaction, recording the exact Plan, Move, task id, rationale, `effect_class = graph-internal`, `structure_level = null`, current role, restrictions, Policy verdict, and `created` disposition.

A stale Plan, a Plan whose active-Intent input set/revisions now require Rebuild, or a stale Move writes neither row. If another operation already owns the same targeted active identity, the whole transaction returns `advance_in_progress` and appends no override Action. The request Action is operational provenance, not a Decision, an Approval Action, an Intent preauthorization, or a mutation of dependencies or priority. It is tied to that immutable Plan id and is never inherited by a later rebuild.

For `human_override`, the CMO may route work only for the exact targeted Move and must submit at least one valid registered route. It may not answer `no_ready_moves`, route a different Move, or author its own blocked reason. `blocked` is accepted only when trusted settlement re-derives a closed registry/capability failure code; otherwise a missing route is an invalid completion and fails the task rather than reinstating the CMO's readiness veto. If the Plan became obsolete, trusted settlement accepts only `obsolete`. The model never fabricates an invalid task merely to satisfy the override.

The override bypasses only the prior semantic readiness judgment. It does not bypass compiled kind support, payload validation, Policy, current restrictions, capability/connection checks, the ordinary agent credit gate, or provider safety. Any later external schedule, publish, send, activate, spend, merge, pause, unpublish, cancel, or close remains a separate `direct/human` commitment in `awaiting_approval` and still requires its own human button.

### D5 — `advancePlanAndRoute` is atomic but does not publish a Plan

The running CMO calls a typed `advancePlanAndRoute` boundary. After exact operation-replay lookup, first application uses the fixed `advancement task → pinned Strategy FOR SHARE → active Plan head FOR UPDATE` lock order, then verifies that the payload Plan is still that head, its Strategy is still active, and the current canonical active-Intent `{ id, revision }` set still equals the Plan-producing Action's planning snapshots. A mismatch returns typed `plan_requires_rebuild` and creates no wave; trusted settlement may then accept only the registered `obsolete` completion after reconfirming it. An Intent change after this validation point may make the committed wave's Plan immediately stale, but never rewrites or rolls back that canonical wave. This matches rebuild's resource order and prevents advance-vs-rebuild/Strategy deadlocks. Trusted code validates and canonicalizes every route through the same registry and Plan-route identity rules used by `publishPlanAndRoute`.

One transaction appends `plan_wave_evaluated` with the evaluation mode, optional human override Action, exact Evidence/Object references, rationale, and complete canonical route mapping, then creates or observes every selected task. Each mapping entry is `{ task_id, disposition: created | observed, origin_root_routing_action_id?, origin_root_routing_task_id? }`: a created root names the current wave Action/task; an observed row retains the earlier Plan/wave Action and routing task only when that Action's `created` mapping originally materialized the same row. An observed lateral descendant may be semantically equivalent but has null root-origin fields. Any invalid route rolls back the Action and every new task. A general evaluation may commit a no-route Action/result with `no_ready_moves`; a targeted override may not. The Action receipt is the authoritative complete mapping; common `TaskCompletion` does not duplicate it.

Exactly one `plan_wave_evaluated` Action may link an advancement `task_id`, enforced by a subtype partial unique constraint. After the task lock, a pre-existing same-task wave is hash-validated and returned; a conflicting payload is rejected. Two tool calls with different operation keys therefore cannot commit two waves for one task or leave TaskCompletion pointing at an arbitrary result. Exact replay returns the historical Action receipt and never rescans current work.

The boundary never edits the Plan, interprets dependencies as claim gates, cancels failed descendants, or executes an external commitment.

### D6 — A later rebuild may withdraw queued wave roots, not descendants

When a new Plan explicitly excludes a Move, `publishPlanAndRoute` may supersede queued root routes for that Move created by either the old Plan-producing Action or a later `plan_wave_evaluated` Action. It considers only mapping entries with non-null root-origin fields, deduplicates their exact task ids in stable order, and conditionally requires the existing agent/automatic, queued, null-Intent, Plan/Move, and no retry/replacement/schedule-lineage shape. Its `parent_task_id` must equal that entry's `origin_root_routing_task_id`, and the referenced origin Action must contain the original `created` mapping for the same row. Thus a later Action may observe an existing root without pretending it created or reparented it, while an observed lateral descendant remains ineligible. This generalizes the initial-wave rule without following lateral work, rechecks, retries, commitments, running rows, or terminal descendants.

## Required contract tests

- Rebuild creates a new Plan Object; advance creates no Object and leaves the exact Plan head/content unchanged.
- Strategy and Plan remain brand-wide singletons: two active Intents are coordinated by one Plan-producing Action with exact planning snapshots, while the Strategy's causal origin grants neither coverage nor Policy authority.
- declaring/adopting/refining/settling/abandoning an active Intent can make the Plan require Rebuild without mutating it or cancelling accepted work; a draft proposal alone cannot; Advance, Ricontrolla and Avvia comunque create no new wave while that projection is true.
- General and targeted subjects do not coalesce; duplicate targeted clicks while active return `advance_in_progress` without a second Action.
- Agent/automatic creators cannot create `human_override`; human override and targeted task commit together; stale Plan/Move, lost authorization, and an active-identity conflict write no Action.
- Exact human-click replay returns its receipt after Plan supersession; same-key/different-hash fails before current-head mutation checks.
- A targeted advancement routes only its exact Move and cannot return `no_ready_moves`; hard invalidity becomes typed `blocked` or `obsolete`.
- Route validation failure rolls back `plan_wave_evaluated` and every task; exact replay returns the original mapping; concurrent different-key calls for one advancement task commit exactly one wave Action.
- Policy, credit, capability, and external-approval gates remain unchanged under an override.
- Source terminalization survives a failed post-commit enqueue; no Plan lock is taken while its row lock is held. A signal before the graph read is visible; a signal absorbed after the read is an accepted best-effort gap, and a later human **Ricontrolla** creates fresh work after terminalization.
- P1 creates a task, P2 becomes the current head and observes that still-running task, and terminalization signals P2 without mutating the task's P1 origin; a current P2 with no producing/wave mapping for the source or any qualifying ancestor receives no signal, and a concurrent head replacement is rechecked in the enqueue transaction.
- A signal whose insertion won returns the same historical task on exact same-key replay even after that candidate Plan is superseded or the ancestry is no longer eligible; same-key/different-hash input fails. A signal that only returned `advance_in_progress` created no receipt and has no such replay guarantee.
- T is mapped by current P for Move M, T creates same-origin lateral/recheck L, T terminalizes while L is active and its evaluation routes nothing, then L terminalizes and attempts a new best-effort evaluation through `L → T`; every hop preserves brand, null Intent and exact origin Plan/M. Cross-brand, non-null-Intent, Plan/Move mismatch, cycle, missing parent, or no current-Plan mapped anchor writes nothing.
- A Plan-derived commitment first requests evaluation when its provider command is accepted. A later terminal provider-outcome Verification requests a second evaluation under a Verification-scoped creator key while deriving eligibility through `Verification → poll → Result → commitment → adopted anchor`; `pending` requests none. A non-Plan commitment, cross-brand/broken causal link, stale Plan, mismatched task/result links, or nonterminal Verification writes nothing, and the poll task remains origin-free with no inherited Policy or Plan authority.
- Exact replay of a provider-final signal returns only the task inserted for that Verification/Plan key and cannot return the earlier acceptance-triggered receipt; observing an already-active general evaluation still creates no alias and retains the same best-effort recovery semantics.
- A directly mapped source is the zero-hop case. A qualifying descendant never appears in the route mapping, gains no root-origin/withdrawal status, and its terminal result is not interpreted as readiness or completion. An observed/rescheduled row keeps its previous parent; without a qualifying preserved chain it relies on **Ricontrolla** rather than being reparented or gaining an `observed-from` alias.
- Rebuild-before-signal makes the creator retry/check the new head; signal-before-Rebuild commits a serially valid coordinator while the Rebuild waits on the Plan. Every general creator takes the shared advisory identity lock, and a running advancement that holds its task while waiting for the Plan cannot deadlock with a signal because the signal never locks or waits for that task.
- Advance-vs-rebuild/Strategy replacement follows the common `task → Strategy → Plan` order without deadlock and never advances a non-head Plan.
- Explicit exclusions may supersede exact queued root routes recorded by Plan or wave Actions, but never descendants, direct/human work, running work, or unrelated Moves.

## Rejected alternatives

- treating every next wave as a new Plan version;
- compiling dependency edges into SQL claim predicates or a generic DAG engine;
- mutating a Move to `ready`, `done`, or `forced`;
- storing a wave table, dirty bit, or outbox solely to close the accepted v1 liveness gap;
- letting the browser choose a specialist kind/payload directly;
- treating a readiness override as authorization for an external effect.
