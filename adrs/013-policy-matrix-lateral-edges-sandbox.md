# ADR-013 — The policy matrix, typed lateral edges, and sandbox rules on eve's real trust model

**Status:** Accepted — 2026-08-05
**Amends:** ADR-007 (the matrix makes the gate concrete), ADR-004 (lateral edges join the non-overlap rules)
**Refs:** ADR-006, ADR-010, ADR-012; eve bundled docs (`concepts/security-model.md`, `sandbox.mdx`, `tools/overview.mdx`)

## Context

Three questions sent back from the ADR-012 round for deeper reasoning: how `structure_level` actually modulates policy verdicts, whether specialists may enqueue work for other specialists, and what the sandbox rules are given how eve actually works (the first formulation — "writes only via MCP" — legislated at the wrong layer: in eve, authored tools and connections both run in the trusted app runtime, and the real boundary is app runtime vs sandbox).

## Decisions

### D1 — The policy matrix is versioned data, with absolute floors

The policy function's third input — Intent structure level — answers "how much has the human already pre-specified this kind of work?": low (a statement), medium (acceptance criteria), high (constraints plus explicit pre-authorizing Decisions). The default verdicts:

| effect class | low | medium | high |
| --- | --- | --- | --- |
| graph-internal | allowed | allowed | allowed |
| reversible-external | approval | verification | allowed |
| communication | approval | approval | verification |
| irreversible-external | approval | approval | approval |
| financial | approval | approval | approval |

Verdicts operationally: `allowed` executes; `requires-verification` executes after the verification pass (mechanical checks plus the specialist's review pass — no human); `requires-human-approval` parks/proposes until a human settles; `denied` never runs.

Rules above the table:

- Structure moves the verdict **at most one step per column** — no jumps.
- **Floors are absolute**: `irreversible-external` and `financial` never go below `requires-human-approval`, at any structure level.
- `communication` never reaches `allowed` by structure alone — full automation there always takes an explicit Decision.
- Policy-override Decisions (the Magister per-category toggles) set a cell explicitly, in either direction, **never below the floors**.
- The matrix is data in `packages/policy`, versioned; the `policy_snapshot` on every Action makes it replayable.

### D2 — Typed lateral edges between specialists

Specialists may request work from other specialists, but only across **declared lateral edges**: `(from → to, kind)` triples in the `packages/agents` registry — e.g. `content → seo-discovery: audit-request`, `lifecycle → content: copy-request`, `growth → content: ad-creative-request`. A need that matches no declared edge returns `blocked` to the CMO hub, which re-routes with judgment.

- Loops die for free: dedup at enqueue (same `kind + subject` already queued is a no-op), and session/pool budgets bound total chain cost.
- Every lateral enqueue carries `rationale` and `parent_task_id` — the chain is visible in the work graph.
- **Authority never travels with the chain**: whatever the downstream specialist does passes through its own policy gates and capabilities. Requesting work transfers no privilege.
- The "who may ask what of whom" topology is versioned code in the registry, next to the non-overlap rules — not emergent from prompts.

### D3 — Sandbox rules on eve's actual trust model

eve's boundary: the **app runtime** (authored tools, connections, model calls, durable state) holds `process.env` and every secret; the **sandbox** (arbitrary bash via the built-in tools) holds no secrets, has an isolated `/workspace`, and egress controlled by `networkPolicy` (default `allow-all` — to be tightened; eve's docs: "do not rely on model behavior alone"). Every subagent gets its own sandbox, independent of the parent.

Our rules:

1. **Every external write is an authored tool or connection call — never a sandbox command.** In the sandbox there is no gate, no `policy_snapshot`, no provenance. Credential brokering (eve's firewall-level header injection) is reserved for authenticated *reads* (e.g. cloning a private repo).
2. **Sandbox egress defaults to `deny-all`, with per-specialist read allow-lists** living in each specialist's own `sandbox/` definition, versioned like the rest of the registry. `seo-discovery` gets web fetch; `content` likely none (image generation goes through the AI Gateway — a model call, not sandbox egress).
3. **Backend caveat**: domain-level allow-lists work only on the `vercel()` and `microsandbox()` backends; Docker honors only `allow-all`/`deny-all`. Dev runs `deny-all`; production on Vercel Sandbox enforces the real allow-list.

Two reinforcements from the tools doc, adopted for free: an interrupted step re-runs, so non-idempotent side effects are made idempotent or gated (validates `execute-proposal` design); and `toModelOutput` projects tool output for the model while channels see the full result (supports the ADR-012 return contract).
