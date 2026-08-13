# ADR-013 — The policy matrix, typed lateral edges, and sandbox rules on eve's real trust model

**Status:** Accepted — 2026-08-05
**Amends:** ADR-007 (the matrix makes the gate concrete), ADR-004 (lateral edges join the non-overlap rules)
**Amended by:** [ADR-017](017-consultative-subagents-durable-root-work.md) (D2: only durable roots may enqueue lateral work; D3: consultative subagents use deny-all egress and brokered reads); [ADR-018](018-one-shot-durable-agent-tasks.md) (lane-specific claim semantics for lateral tasks)
**Amended by:** [ADR-019](019-human-approved-external-commitments.md) (D1/D3: effect phase is explicit; all external commitments have a human-approval floor and execute outside eve)
**Amended by:** [ADR-020](020-typed-decisions-and-impact-verification.md) (D1: exact-Intent preauthorizations may raise structure; current brand restriction heads are separate and restrict-only)
**Refs:** ADR-006, ADR-010, ADR-012; eve bundled docs (`concepts/security-model.md`, `sandbox.mdx`, `tools/overview.mdx`)

## Context

Three questions sent back from the ADR-012 round for deeper reasoning: how `structure_level` actually modulates policy verdicts, whether specialists may enqueue work for other specialists, and what the sandbox rules are given how eve actually works (the first formulation — "writes only via MCP" — legislated at the wrong layer: in eve, authored tools and connections both run in the trusted app runtime, and the real boundary is app runtime vs sandbox).

## Decisions

### D1 — The policy matrix is versioned data, with absolute floors

The policy function's fourth input — Intent structure level or explicit `null` — answers "how much has the human already pre-specified this kind of work?": low (no acceptance criteria), medium (non-empty acceptance criteria), high (criteria plus non-empty constraints plus at least one applicable exact-Intent preauthorization). The other inputs are Actor identity, trusted authorization context, and effect signature, as summarized in ARCHITECTURE. For a new Intent-bound task or an exact-Intent `intent_preauthorization` Decision boundary it first requires the canonical same-brand Intent be `active`, then derives from that current revision and only active preauthorization heads with `content.authorized = true`, whose producing Action links that exact same-brand Intent and whose registered key applies to the effect. An agent-authored draft is only a proposal: it has no Policy structure, cannot receive preauthorization, and cannot originate work until `adoptIntent` commits. An active false head is a revocation and never raises structure. Roadmap, model and brand-policy Decisions never raise structure. In particular, a brand-wide Strategy remains on the null-structure branch even when its Action records one causal `originIntentId`; that id is provenance, not a capability handle. Every non-Intent-bound operation—including administrative brand Decisions, Plan-routed tasks, and registered origin-free tasks—records `structure_level = null` and an empty preauthorization set instead of fabricating an Intent. That unstructured branch cannot be more permissive than the `low` column, still reloads current brand restrictions, and never treats Strategy, Plan, a Plan Action's planning Intent snapshots, or an origin-free kind as authorization. For execution or a Verification that fulfils an existing Intent-bound task, structure derives from that task's immutable `intent_snapshot`; any non-Intent task keeps the null branch, with exact Plan/Move provenance when present. A follow-up/lateral/commitment task is new work even when requested inside a running task: an Intent-bound source must still be active and resolves the current revision if insertion wins, while a Plan-routed source preserves null Intent and its Plan/Move origin unless a distinct explicit Intent has been created. The Action's `policy_snapshot` records the nullable level, any revision, and selected preauthorization Object ids, so later refinement cannot reinterpret accepted work. The default verdicts:

An interactive `refineIntent` is a separate human-authorized graph-internal boundary: it rereads the current Member and accepts only `owner | admin | member` in the exact top-level CMO conversation turn. The Action is CMO-produced, but its `policy_snapshot` freezes the authorizing human Actor, current Member role/verdict, and trusted turn lineage. This authority ends with that typed refinement call: raising derived structure does not itself authorize `recordDecision`, create work, or lower the independent human floor for an external commitment. Interactive `request_specialist_work` is a second boundary: the current human request must identify the nominated active Intent without ambiguity. That authorizes only the semantic association and internal work request; trusted code still derives structure/preauthorization, reloads current restrictions and capabilities, applies credit admission, and preserves every external-commitment approval floor.

| effect class | low | medium | high |
| --- | --- | --- | --- |
| graph-internal | allowed | allowed | allowed |
| external-preparation | allowed | allowed | allowed |
| reversible-external commitment | requires-human-approval | requires-human-approval | requires-human-approval |
| communication commitment | requires-human-approval | requires-human-approval | requires-human-approval |
| irreversible-external commitment | requires-human-approval | requires-human-approval | requires-human-approval |
| financial commitment | requires-human-approval | requires-human-approval | requires-human-approval |

The effect signature now includes a trusted phase. `external-preparation` means a registry-approved, create-only non-committal provider draft. Every external commitment has an absolute `requires-human-approval` floor: the root or CMO creates a human-activation direct task and continues, rather than parking. `approveTask` evaluates the final revision and queues that same row; deterministic application code performs the fixed operation later. `denied` never runs.

Rules above the table:

- Structure and current brand `policy_restriction` Decision heads may tighten the default, never expand authority or lower the external-commitment floor. They are reloaded at every **new authorization, new-work, or graph-write Policy boundary** and their exact Object ids enter `policy_snapshot`; they are not frozen as preauthorizations in an Intent snapshot. ADR-019 is the explicit execution exception: an Approval Action freezes the click-time grant. A restriction added after approval does not silently revoke the queued commitment; an authorized human must win `cancelTask` before claim. Claim still validates the frozen grant plus current connection, registry, deadline, and safety preflight, but does not rerun write Policy.
- Actor type does not grant a capability. System Actors are deny-by-default and selected only by trusted application code for an exact registered internal operation. In v1 `system:context-dev` may only produce deterministic Brand Context v0 and its evidence; it may not call generic graph-write, decomposition, task, approval, Decision-recording, or external-commitment paths. Decision-impact Evidence and Verification are instead authored by Growth through its ordinary agent tool/settlement boundaries.
- Reversibility and “safe direction” do not create an autonomous path: pause, unpublish, cancel, and close also require the button.
- Organization-wide Better Auth Member roles still restrict who may approve: owner/admin for every category, members for non-financial commitments, viewers for none. `actors.role` is not an authorization source, and a brand Decision cannot rewrite that organization-wide role matrix.
- The matrix is data in `packages/policy`, versioned; the `policy_snapshot` on every Action makes it replayable.

### D2 — Typed lateral edges between specialists

> **Amended by ADR-017 and ADR-018.** The topology below remains valid for durable named-root tasks. A consultative declared subagent has no task-enqueue tool; it returns suggested work to the CMO instead. Every lateral request reaches the same atomic task service and is executed only after the responsible root claims it under the lane-specific protocol.

Specialists may request work from other specialists, but only across **declared lateral edges**: `(from → to, kind)` triples in the `packages/agents` registry — e.g. `content → seo-discovery: audit-request`, `lifecycle → content: copy-request`, `growth → content: ad-creative-request`. A need that matches no declared edge returns `blocked` to the CMO hub, which re-routes with judgment.

The durable-root tool is `request_lateral_work({ kind, payload, rationale })`. Trusted task context supplies the source task, brand, parent, and common-origin branch; the model cannot submit an Intent, Plan, Move, or subject. An Intent-bound source resolves the current Intent revision only if a new row is inserted. A Plan-routed source may target only a kind declaring `acceptsPlanRouteOrigin: true` and preserves its exact Plan/Move pair with null Intent. Every genuinely inserted lateral row receives immutable `parent_task_id = source_task_id`; an observed row preserves its existing parent and gains no alias or authority. Registry materialization rejects an edge whose target cannot accept every origin branch from which that edge is callable.

- Loops die for free: the active-key constraint observes one existing `(kind, brand_id, subject_key)` task without rewriting it, the winning task's creator key absorbs replay of that creation, and session/pool budgets bound total chain cost. V1 stores no exact aliases for distinct requests coalesced onto that task.
- Every lateral enqueue carries `rationale` and `parent_task_id` — the chain is visible in the work graph.
- **Authority never travels with the chain**: whatever the downstream specialist does passes through its own policy gates and capabilities. Requesting work transfers no privilege.
- The "who may ask what of whom" topology is versioned code in the registry, next to the non-overlap rules — not emergent from prompts.

### D3 — Sandbox rules on eve's actual trust model

> **Amended by ADR-017.** The app-runtime/sandbox trust boundary remains. Consultative declared subagents use `deny-all` sandbox egress and reach external data only through validated read operations; per-specialist sandbox read allow-lists apply only where the durable root definition explicitly needs them.

eve's boundary: the **app runtime** (authored tools, connections, model calls, durable state) holds `process.env` and every secret; the **sandbox** (arbitrary bash via the built-in tools) holds no secrets, has an isolated `/workspace`, and egress controlled by `networkPolicy` (default `allow-all` — to be tightened; eve's docs: "do not rely on model behavior alone"). Every subagent gets its own sandbox, independent of the parent.

Our rules:

1. **External preparation and commitment have different owners.** A safe provider draft is an authored create-only operation in the root app runtime. A commitment is never an agent tool: it is the deterministic handler of a human-approved task in the responsible root. Neither may be a sandbox command, where there is no gate, `policy_snapshot`, or provenance. Credential brokering remains reserved for authenticated reads.
2. **Sandbox egress defaults to `deny-all`, with per-specialist read allow-lists** living in each specialist's own `sandbox/` definition, versioned like the rest of the registry. `seo-discovery` gets web fetch; `content` likely none (image generation goes through the AI Gateway — a model call, not sandbox egress).
3. **Backend caveat**: domain-level allow-lists work only on the `vercel()` and `microsandbox()` backends; Docker honors only `allow-all`/`deny-all`. Dev runs `deny-all`; production on Vercel Sandbox enforces the real allow-list.

Two reinforcements from the tools doc remain useful: an interrupted agent step may re-run, so every create-only draft operation declares one of three replay contracts in the registry: stable provider-key idempotency, deterministic recovery lookup, or explicit duplicate safety. The third is at-least-once and may leave harmless private drafts orphaned; it is never described as exactly-once. `toModelOutput` projects tool output for the model while channels see the full result. Human external commitments do not inherit agent-step retry at all (ADR-019).
