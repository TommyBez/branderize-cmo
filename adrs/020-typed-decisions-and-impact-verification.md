# ADR-020 — Typed Decisions and one-shot impact verification

**Status:** Accepted — 2026-08-11
**Deciders:** Tommaso, architecture grilling with assisted analysis
**Amends:** ADR-002 (Decision schema), ADR-008 (Decision authorship and supersession), ADR-010 (plan inputs), ADR-011 (impact loop and organization override), ADR-012 (preauthorization selection), ADR-013 (current restrictions versus pinned preauthorizations), ADR-014 (Object cardinality and Action links), ADR-015 (registered agent kind), ADR-017 (follow-up ownership), and ADR-018 (agent settlement)
**Refs:** the existing work-graph grammar and the current CRM's one-shot due-task pattern. The CRM has no Decision-impact lifecycle; the adaptation below is Branderize-specific.

## Context

The architecture gave `Decision` a clear product role but not an implementable contract. A Decision was an immutable Object that could influence Policy, the plan, task snapshots, model resolution, and later Verification, while its JSON shape, scope, cardinality, Intent relation, and impact comparator remained implicit. The feedback loop also promised a judgment at a future horizon without creating any durable work that would wake up then.

V1 closes those gaps without adding `decisions`, `decision_versions`, a generic relation table, a schedule type, or a universal measurement DSL. A canonical Decision exists only when a consumer already exists for its registered kind. Measurement remains agentic: a model may explore any read tool available to its root and then record its interpreted observation through the typed brain write path.

## Decisions

### D1 — `DecisionContent` is a small closed union

`packages/brain` owns the versioned, discriminated `DecisionContent` schema:

```ts
type RoadmapInputKey = "strategy";

type RoadmapInputDecision = {
  [K in RoadmapInputKey]: {
    schema_version: 1;
    kind: "roadmap_input";
    key: K;
    value: RoadmapInputValueByKey[K];
    impact: { mode: "not_applicable" } | MetricImpactPlan;
  };
}[RoadmapInputKey];

type PolicyRestrictionDecision = {
  [K in PolicyRestrictionKey]: {
    schema_version: 1;
    kind: "policy_restriction";
    key: K;
    restriction: PolicyRestrictionByKey[K];
  };
}[PolicyRestrictionKey];

type IntentPreauthorizationDecision = {
  [K in PreauthorizationKey]: {
    schema_version: 1;
    kind: "intent_preauthorization";
    key: K;
    authorized: boolean;
    policy_facts: PreauthorizationFactsByKey[K];
  };
}[PreauthorizationKey];

type DecisionContent =
  | RoadmapInputDecision
  | PolicyRestrictionDecision
  | {
      schema_version: 1;
      kind: "model_override";
      agent_key: AgentKey;
      model_profile_key: ModelProfileKey;
    }
  | IntentPreauthorizationDecision;
```

Every `*ByKey` map is a closed Zod union in code. Neither `kind`, `key`, Policy facts, model profile, nor a raw JSON value is accepted without its registered schema. The only v1 roadmap head is `strategy`, whose closed value contains a size-capped semantic direction, ordered priorities and explicit guardrails. Those fields are reviewable human-approved input, not numeric instructions for a deterministic compiler: the CMO interprets them when generating a Plan. Goal and definition-of-done remain on Intent; budget, timeline and durable constraint heads are deferred until they have closed schemas and an explicit CMO consumer. A new Decision family or key is an explicit registry, consumer and schema addition, not a free-form Object convention.

A roadmap input that claims measurable impact uses one provider-independent measurement brief:

```ts
type MetricDefinition = {
  name: string;
  description: string;
  unit: string;
  scope: string;
};

type MetricImpactPlan = {
  mode: "metric";
  metric: MetricDefinition;
  baseline: {
    value: DecimalString;
    window_start: IsoDateTime;
    window_end: IsoDateTime;
    evidence_object_id: ObjectId;
  };
  target: {
    operator: "gte" | "lte";
    value: DecimalString;
  };
  observation_window: {
    start: IsoDateTime;
    end: IsoDateTime;
  };
  evaluate_at: IsoDateTime;
};
```

The model chooses the useful metric, source and read tools. PostHog is only one example: the same root may use Google Analytics, a warehouse, an MCP server, an OpenAPI connection or another available measurement surface. After interpreting the result, it calls the ordinary model-visible `record_evidence` tool with the closed `metric_observation` schema: metric definition, decimal value, unit, window, source summary and rationale. The tool validates shape, derives brand, Actor, task and session from trusted context, and atomically writes the immutable Evidence Object plus its producing Action. It does not independently certify the provider result: the Evidence is explicitly an agent-authored observation with durable provenance.

Relative goals are normalized to an absolute decimal target before Decision persistence. The baseline must reference a same-brand immutable `metric_observation` whose metric definition, decimal value, unit and window exactly match the plan. `evaluate_at` is an absolute future instant at or after the observation-window end. No provider, query language, tool name or executable measurement recipe is frozen into the Decision. What becomes immutable at the human click is the semantic metric definition, baseline, target and horizon.

There is no active “measurable Decision missing its plan” state. A roadmap input declares either `not_applicable` or a complete metric plan; incomplete recommendations remain conversation/task output and open questions rather than canonical Decisions.

### D2 — Every Decision is one logical head derived by trusted code

A Decision remains an immutable `objects` row with `type = 'decision'`. Every v1 Decision has a non-null `singleton_key`; there are no collection-like Decisions.

| kind | scope | derived active-head key |
| --- | --- | --- |
| `roadmap_input` | brand | `decision:roadmap:<key>` |
| `policy_restriction` | brand | `decision:policy:<key>` |
| `model_override` | brand | `decision:model:<agent_key>` |
| `intent_preauthorization` | exact Intent | `decision:intent:<intent_id>:preauthorization:<key>` |

`packages/brain` derives the key from validated input and trusted brand/Intent context. A browser, model, task payload, or provider never supplies `singleton_key`. The existing partial unique index on active `(brand_id, singleton_key)` permits one current head per logical slot.

The Object id is the Decision version identity. Replacing a head inserts a new immutable Object id and atomically changes the exact previous head to `superseded` with `superseded_by = new_id`. Dismissing an override is an explicit expected-head operation. There is no `revision`, mutable Decision content, or phrase “Decision version” without an exact Object id.

All Decision Objects are brand-scoped in v1. An `intent_preauthorization` additionally requires the producing Action's exact same-brand **active** `intent_id` and is the only Decision family whose scope and Policy structure come from that Intent. Other kinds may carry an originating Intent as causal provenance; a measurable roadmap Decision requires one so later impact work can explain which objective triggered the choice. That causal id does not scope the brand-wide Strategy, enumerate the Intents it covers, copy exact-Intent preauthorization, or become a future active-status gate. A terminal accepted Intent remains valid historical provenance, while an agent-authored draft is never valid Decision authority or origin. The Better Auth role matrix remains organization-wide code. A `policy_restriction` may only tighten one brand; organization-wide Decision Objects are deferred rather than simulated by duplicated or cross-brand rows.

### D3 — Active Decisions are human-authored; agents recommend

V1 `recordDecision` is a product mutation under ADR-001's current non-viewer role matrix. It reloads the exact current Better Auth Member, materializes that User's global human Actor, and records that Actor as the producing Action. CMO and specialist sessions may produce Evidence, reports, open questions, and typed Decision recommendations, but they cannot call `recordDecision` or impersonate the human who initiated a conversation.

No pending-Decision table or generic Proposal Object is added. A durable recommendation is an ordinary immutable `report` Object with closed subtype `decision_recommendation`; it contains the proposed `DecisionContent`, nullable origin Intent id, rationale and the exact head id observed by the agent. A report produced by `decision-reconsideration` is narrower: its origin Intent id is non-null, is derived from the Decision's producing Action, and cannot be changed or omitted by the CMO. `TaskCompletion` references that report Object id rather than duplicating the proposal. A chat card or console button loads that exact report and invokes an authenticated Server Action; trusted code revalidates it and calls `recordDecision` with its content, source report id, the same causal origin Intent id and expected head. For `roadmap_input:strategy`, the typed confirmation renderer must show the proposed content, label the Intent as causal provenance, identify the exact current Strategy head/summary that will be replaced (or create-only null), state that the scope is the entire brand and that a global Plan rebuild follows, and state that already accepted/running work and commitments are not cancelled. A renderer omitting any of those facts cannot expose the action button. The origin may now be terminal; actionability depends on the exact Decision head, not on reopening or keeping that historical Intent active. Interactive CMO recommendations use the same report shape and renderer before presenting the button. Only that subsequent human action creates or supersedes the canonical Decision. This preserves “never overwrite a human” without inventing another execution lifecycle.

### D4 — `recordDecision` atomically writes the head and its required work

The trusted operation accepts `brandId`, nullable `originIntentId`, nullable same-brand `sourceRecommendationId`, exact `expectedHeadId` (including explicit `null` for create-only), typed content, a stable `requestId`, and human rationale. Trusted code derives `operation_key = decision-record:<user_id>:<request_id>` and a canonical `request_hash` over the complete intended mutation, including the source report, expected head, origin Intent, typed content, and rationale. When a source report is present, its closed recommendation content and origin Intent must agree exactly with the request. `intent_preauthorization` requires a non-null exact same-brand **active** Intent and uses the Intent-bound Policy branch. A measurable `roadmap_input` also requires a non-null same-brand origin, but only as causal provenance: `active`, `settled`, and `abandoned` accepted Intents are valid, while `draft` is rejected. Every roadmap Strategy remains a brand-wide mutation evaluated with `structure_level = null`, no exact-Intent preauthorization set, and current brand restrictions. A terminal causal origin therefore does not make a reconsideration report obsolete, reopen the Intent, or turn the replacement into an Intent-scoped Decision. Other administrative brand Decisions may omit origin. Actor, organization role and brand scope come from `BrainWriteContext`, not request fields.

Before the transaction, code validates the closed Decision shape and performs no provider I/O. In one transaction `recordDecision` resolves the brand, locks the exact current Better Auth Member `FOR SHARE`, and calls `ensureHumanActor` in the common order. It then acquires the transaction-scoped advisory lock derived from `(brand_id, operation_key)` and looks up the Action receipt. Same key and hash returns the historical Decision and every deterministically derived task created with it without rechecking the now-current head or replaying Policy; same key with another hash fails. The advisory lock makes concurrent first calls converge on that lookup; the partial unique index remains the database backstop. Only when no replay row exists does it continue:

1. when `originIntentId` is non-null, locks and validates that exact same-brand Intent; requires `active` only for `intent_preauthorization`, otherwise rejects `draft` while allowing accepted historical states; separately enforces non-null for every registered Decision kind that requires causal Intent provenance; then locks the derived Decision head and reads/validates the immutable source recommendation and every referenced same-brand `metric_observation` Evidence Object;
2. evaluates Policy and the no-agent-supersession rule, using Intent structure only for `intent_preauthorization` and the null-structure brand branch for Strategy even when it carries a causal origin;
3. allocates the new Object id and appends the human `decision_recorded` Action with that operation key/hash;
4. when replacing a head, changes the exact old row from `active` to `superseded`, freeing the partial-unique active slot;
5. inserts the new immutable Decision Object as `active`, then fills the old row's `superseded_by` with that new id; and
6. for `kind = 'roadmap_input' AND key = 'strategy'`, creates or observes one non-Intent-bound CMO `rebuild-marketing-plan` task with payload `{ strategy_decision_id: new_id }` and an initial creator key derived from that Decision id; and
7. for `impact.mode = 'metric'`, creates or observes exactly one future **origin-free** `verify-roadmap-decision-impact` task for the new Decision id, with null Intent/snapshot and null Plan/Move and only `{ decision_id }` in the kind payload. The immutable Decision plus its producing Action retain the originating Intent provenance; the measurement task receives no Intent-acceptance authority.

Failure to create or exactly replay every required task rolls back the Action, Object, and supersession. A measurable Strategy creates both the immediate CMO Plan task and future Growth impact task in that transaction. A stale expected head on a genuinely new operation writes nothing and returns `stale_head`; replay of an operation that previously won still returns its historical Decision/tasks after that head has later been superseded.

### D5 — Impact verification is a one-shot Growth agent task

The registered task is:

```text
kind: verify-roadmap-decision-impact
worker_key: growth
execution_mode: agent
activation: automatic
payload: { decision_id }
due_at: Decision.content.impact.evaluate_at
subject_key: decision-impact:<decision_id>
idempotency_key: decision-impact-initial:<decision_id>
common_origin: none
```

Growth owns analytics, attribution, experiments and measurement. At `due_at`, its durable root opens one ordinary one-shot Eve task session, reads the immutable Decision and may use any read tool available in its compiled surface. The source is not pinned: PostHog, Google Analytics, a warehouse or another connected measurement system may be used, separately or together. External writes remain governed by the universal human-commitment boundary and are not part of this task.

If Growth obtains a comparable observation, it calls `record_evidence` exactly as it did for the baseline. The resulting `metric_observation` is an agent-authored Evidence Object whose producing Action is linked to this task/session. It then stages the common `TaskCompletion` with `status = 'completed'`, `intent_acceptance = null`, and one closed kind-specific `result`: `judgment = 'supported' | 'not_supported'` requires that current Evidence id and a rationale; `judgment = 'inconclusive'` requires a rationale and may omit Evidence when access or comparability is missing. These judgments are not additional task statuses. This kind's registered `requiredOutputObjectIds(result)` returns the current Evidence id whenever the validated result contains one, so `finishTask` foregrounds it even if the model omitted it from `output_object_ids`; an inconclusive result with no observation returns `[]`. Because the task is origin-free, `finishTask` rejects any non-null `intent_acceptance`; Strategy impact and Intent acceptance can never be combined in one completion. The model may choose and interpret the measurement tools, but it cannot change the Decision's frozen metric definition, unit, target, observation window or horizon. A different source is valid; a silently different success definition is not.

On terminal settlement, trusted code locks the authoritative task and Decision, validates the staged `TaskCompletion.result`, validates any cited Evidence as same-brand and produced by this task, and checks that a conclusive observation names the frozen metric definition, unit and observation window. It persists the model's typed judgment rather than pretending to independently prove the provider data. The terminal Decision-impact Verification is a distinct Action produced by the Growth agent Actor, with a nullable structural `decision_id` same-brand foreign key to `objects`, plus its `task_id`. Its typed payload contains the exact plan/hash, baseline and final Evidence Object ids (or an absence rationale), and one judgment:

```text
supported | not_supported | inconclusive
```

One transaction appends that Verification Action, links the task's result, and settles the task. A partial unique constraint permits at most one Decision-impact Verification Action per verification task. All three judgments are kind-specific results under `TaskCompletion.status = 'completed'` and execution status `succeeded`. This transaction never changes the originating Intent: `supported`, `not_supported`, and `inconclusive` are judgments about the Strategy Decision only. In particular, `not_supported` does not mutate Intent status; if the Intent is active it remains active unless an independent authorized settlement or abandonment wins concurrently. Only its own exact-revision acceptance Verification or an explicit human settlement/abandonment can make it terminal. Delivery or model/session failure follows the ordinary one-shot agent lifecycle and records no fabricated observation or judgment. The task consumes agent credit, so `due_at` means “not before”: insufficient balance leaves it queued. It creates no recurring schedule, `scheduleRecheck`, or `next_*` successor.

If the same locked Decision is still active and the judgment is `not_supported`, that settlement transaction also creates or observes the registered **origin-free** agent/automatic CMO `decision-reconsideration` task with subject `decision-reconsideration:<decision_id>` and trusted payload `{ decision_id, verification_action_id, origin_intent_id }`. The origin id is immutable causal context derived from the Decision's producing Action, not a request to snapshot, reopen, or borrow Policy authority from an Intent. Before producing a report, the task reloads the Decision head and validates that historical origin still resolves same-brand and non-draft. It completes with `{ outcome: 'obsolete', reason: 'decision_inactive' }` and no report only when the Decision is no longer the active head; otherwise it may produce one same-task `decision_recommendation` report and complete `{ outcome: 'recommended', report_object_id }`. That report retains the exact observed head, Verification Action and non-null causal origin; the CMO receives no authority to supersede the Decision. The recommendation remains actionable only while the same Decision head is current. Settlement or abandonment of the origin does not invalidate the brand-wide Strategy or report, and the human replacement boundary does not create or reopen an Intent. Starting a genuinely new objective still requires an explicit new Intent.

If the Decision was superseded or dismissed, the Growth agent should stop as `inconclusive(decision_inactive)` when it observes that state, and terminal settlement rechecks it under lock. A supersession committed before impact settlement therefore makes the result inconclusive; a previously committed negative Verification may already have created review work, whose closed result contract distinguishes `recommended` from `obsolete` as above.

### D6 — `contested` is a projection, never Object state

`objects.status` remains `active | superseded | dismissed`. For v1:

```text
contested = Decision is still active
            AND its impact Verification judgment is not_supported
```

`inconclusive` is displayed separately as “verification unavailable”. Superseded Decisions retain their historical Verification but disappear from the active contested projection. A negative result never mutates Decision content, grants authority, or automatically records a replacement.

### D7 — Consumers select exact registered heads

- The CMO Plan task reads its exact brand-wide `strategy` Decision plus the current active Intent portfolio. Its producing Action pins the exact typed Intent revisions considered as planning inputs and every exact Evidence/Move Candidate Object id actually used. Those Intent snapshots are provenance for that Plan synthesis, not its common origin or Policy authority. Plan persistence rechecks the Strategy and planning-input set under ADR-012; later Intent drift makes the Plan require an explicit Rebuild without changing already accepted work.
- Model resolution reads only `decision:model:<agent_key>` and resolves its registered model profile.
- Policy reloads current brand `policy_restriction` heads at every new authorization/new-work/graph-write boundary because they may only tighten authority; the exact ids enter `policy_snapshot`. Execution of an already-approved external commitment follows ADR-019's frozen-grant exception.
- A new Intent-bound task selects only active `intent_preauthorization` heads with `content.authorized = true`, whose producing Action has that exact `intent_id`, and whose registered key applies to the task/effect. An active `authorized = false` head is the durable revocation and never enters the snapshot or raises structure. Only positively authorized Object ids and minimal typed facts enter `intent_snapshot.preauthorizing_decisions`.

Roadmap, model and brand restriction Decisions are not indiscriminately copied into every task snapshot. Each consumer owns an explicit selector over exact derived keys.

## Contract tests

The implementation is invalid if any of these are possible:

- a Decision kind/key/value, model profile, Policy fact, singleton key or worker bypasses its closed registry schema;
- a caller supplies `singleton_key`, creates two active heads for one logical slot, mutates Decision content, or supersedes without the exact expected head;
- an exact `recordDecision` replay is resolved after current-head/Policy mutation checks, returns a newer head, creates another Action/task, or accepts the same operation key with a different canonical hash;
- an agent/system Actor records or supersedes an active v1 Decision, or a CMO recommendation is presented as canonical before the human action;
- a Decision recommendation cannot be recovered by exact report Object id, is duplicated in TaskCompletion, or is accepted after its observed head changed; the reconsideration kind lacks its closed recommended/obsolete result, a reconsideration report omits/changes its immutable causal origin Intent or ids, the human boundary drops that origin, or the report remains actionable after the Decision head became ineligible;
- a Strategy confirmation can expose its button without showing brand-wide scope, exact replaced head/create-only state, causal-origin labeling, the global Rebuild consequence, or preservation of already accepted work and commitments;
- an Intent preauthorization is selected through JSON alone, crosses brand/Intent scope, has `authorized = false`, or a roadmap/model/restriction Decision leaks into `preauthorizing_decisions`;
- a Strategy Decision commits without its initial CMO Plan task, a measurable Decision commits without its Growth impact task, or any required task commits separately from the Decision/Action/supersession;
- a `marketing_plan` cites nonexistent, cross-brand or wrong-type Strategy/Evidence/Move Candidate ids, records a Strategy id different from its trusted task, omits the exact active-Intent revisions used by its producing Action, treats those snapshots as Policy authority, or supersedes the Plan after that Strategy stopped being active;
- a relative target survives normalization, baseline Evidence is missing/mismatched, or `record_evidence` accepts caller-supplied brand/Actor/task/session attribution;
- Decision-impact settlement writes a task result without its linked Action or vice versa, creates two Verification Actions for one task, accepts `supported` or `not_supported` for an inactive Decision instead of the allowed `inconclusive(decision_inactive)`, accepts conclusive judgment without same-task current Evidence, turns a technical error into a negative marketing judgment, accepts non-null `intent_acceptance`, or changes any Intent state;
- a negative Verification supersedes a Decision, lets the CMO overwrite a human head, closes/reopens its origin Intent, makes a brand-wide Strategy invalid merely because that causal origin became terminal, or stores `contested` as mutable Object state;
- an organization-wide override is inferred from one brand Decision.

## Consequences

The design adds one small Decision registry, one nullable structural Action link, and two closed one-shot kinds: Growth impact measurement and CMO reconsideration; Strategy additionally uses ADR-010's CMO Plan kind. It reuses the existing model-visible `record_evidence` brain tool, Object, Action, task, unique-head and one-shot agent machinery. Measurement sources remain open-ended and the judgment dataset becomes queryable by exact Decision id without a parallel Decision lifecycle.

## Rejected alternatives

- `decisions`, `decision_versions`, `decision_links`, `intent_decisions`, or `judgments` tables;
- free-form Decision JSON, caller-authored scope/key, or a universal measurement DSL;
- a mandatory registry of metric keys, provider adapters, executable query recipes or deterministic measurement handlers;
- v1 goal/budget/timeline/constraint heads without closed schemas and an explicit consumer;
- storing `contested` or a Decision revision column;
- recurring schedules or agent-chosen `scheduleRecheck` for a fixed horizon;
- automatic CMO supersession after a negative result;
- organization-wide Decisions in a brand-scoped grammar without a real organization-scoped schema.
