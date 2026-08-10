# ADR-013 — The policy matrix, typed lateral edges, and sandbox rules on eve's real trust model

**Status:** Accepted — 2026-08-05
**Amends:** ADR-007 (the matrix makes the gate concrete), ADR-004 (lateral edges join the non-overlap rules)
**Amended by:** [ADR-017](017-consultative-subagents-durable-root-work.md) (D2: only durable roots may enqueue lateral work; D3: consultative subagents use deny-all egress and brokered reads); [ADR-018](018-one-shot-durable-agent-tasks.md) (lane-specific claim semantics for lateral tasks)
**Amended by:** [ADR-019](019-human-approved-external-commitments.md) (D1/D3: effect phase is explicit; all external commitments have a human-approval floor and execute outside eve)
**Refs:** ADR-006, ADR-010, ADR-012; eve bundled docs (`concepts/security-model.md`, `sandbox.mdx`, `tools/overview.mdx`)

## Context

Three questions sent back from the ADR-012 round for deeper reasoning: how `structure_level` actually modulates policy verdicts, whether specialists may enqueue work for other specialists, and what the sandbox rules are given how eve actually works (the first formulation — "writes only via MCP" — legislated at the wrong layer: in eve, authored tools and connections both run in the trusted app runtime, and the real boundary is app runtime vs sandbox).

## Decisions

### D1 — The policy matrix is versioned data, with absolute floors

The policy function's third input — Intent structure level — answers "how much has the human already pre-specified this kind of work?": low (a statement), medium (acceptance criteria), high (constraints plus explicit pre-authorizing Decisions). The default verdicts:

| effect class | low | medium | high |
| --- | --- | --- | --- |
| graph-internal | allowed | allowed | allowed |
| external-preparation | allowed | allowed | allowed |
| reversible-external commitment | approval | approval | approval |
| communication commitment | approval | approval | approval |
| irreversible-external commitment | approval | approval | approval |
| financial commitment | approval | approval | approval |

The effect signature now includes a trusted phase. `external-preparation` means a registry-approved, create-only non-committal provider draft. Every external commitment has an absolute `requires-human-approval` floor: the root or CMO creates a human-activation direct task and continues, rather than parking. `approveTask` evaluates the final revision and queues that same row; deterministic application code performs the fixed operation later. `denied` never runs.

Rules above the table:

- Structure and policy overrides may tighten the default, never lower the external-commitment floor.
- Reversibility and “safe direction” do not create an autonomous path: pause, unpublish, cancel, and close also require the button.
- Roles still restrict who may approve: owner/admin for every category, members for non-financial commitments, viewers for none.
- The matrix is data in `packages/policy`, versioned; the `policy_snapshot` on every Action makes it replayable.

### D2 — Typed lateral edges between specialists

> **Amended by ADR-017 and ADR-018.** The topology below remains valid for durable named-root tasks. A consultative declared subagent has no task-enqueue tool; it returns suggested work to the CMO instead. Every lateral request reaches the same atomic task service and is executed only after the responsible root claims it under the lane-specific protocol.

Specialists may request work from other specialists, but only across **declared lateral edges**: `(from → to, kind)` triples in the `packages/agents` registry — e.g. `content → seo-discovery: audit-request`, `lifecycle → content: copy-request`, `growth → content: ad-creative-request`. A need that matches no declared edge returns `blocked` to the CMO hub, which re-routes with judgment.

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
