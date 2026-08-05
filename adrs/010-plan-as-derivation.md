# ADR-010: The plan is a derivation, and other lessons from the Magister product

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), grilling session on the authenticated [Magister](https://magistermarketing.com) product (Chat, Plan, Permissions, Workflows, Briefs, MCP reference)
- **Builds on:** [ADR-002](002-postgres-work-graph.md) (projections), [ADR-004](004-extended-roster.md) (CMO role), [ADR-007](007-approvals-and-tasks-queue.md) (approvals), [ADR-008](008-brain-write-path-and-model-resolution.md) (capabilities), [ADR-009](009-agent-deployment-and-console-data-surface.md) (console)

## Context

An authenticated exploration of Magister surfaced six questions. The richest finding: their marketing plan is **compiled, not authored** — `Compile status: active`, separate "Rerun audit" and "Rebuild plan" buttons, plan versions, and roadmap inputs (budget, bandwidth, goal, timeline, channels, autonomy, constraints) that *"resize and reprioritize the compiled roadmap"*. Q1 was refined in discussion: their process is **not** totally deterministic — it is deterministic in structure (selection, prioritization, grouping, versioning) and LLM in content (audit interpretation, move candidates, narratives), with a structured evidence layer as the boundary between the two.

## Decision

### 1. The plan is a derivation, not an artifact (Q1, refined)

Two phases with a data boundary:

- **Evidence production** (agentic, expensive): audits, research, probes → structured `evidence` Objects with stable citation keys in the `channel.domain.kind.index` shape (their `channel.geo.finding.0` pattern) — the same keys the digest's citations will use.
- **Plan derivation** (mechanical, free): filter candidate moves by active Decisions (budget, constraints), prioritize by the strategy Decision, group by funnel stage, version. **No model call**: changing a roadmap-input Decision re-derives the plan instantly, at zero credits.

The LLM writes the **ingredients** (move candidates with evidence citations, effort/impact estimates, narratives), never the plan. The CMO's role shifts accordingly: from authoring plans to producing evidence ingredients and proposing roadmap-input Decisions. The plan Object's producing Action pins its input set (evidence versions + decision versions): *"why does the plan say this?"* is mechanically answerable, and a version diff is explainable ("move X dropped because the budget Decision changed"). The marketing health score is the compiled KPI with trend.

### 2. The policy UI writes Decisions (Q2)

The console renders the policy as per-category ask/auto switches (their seven: email, social publishing, content publishing, paid ads, code/PRs, destructive, other external — default: ask). Toggling a switch writes a Decision (`type: policy-override`, scoped brand × effect class) that `packages/policy` reads. The UI stays as simple as Magister's; the state it edits is versioned with provenance instead of being a settings row. The four policy outcomes stay internal; the user sees a binary per category.

### 3. The dangerous thing is impossible at the connector, not just gated (Q3)

Draft and publish are **separate tools** (their `content:write` vs `content:publish` scope split); ad campaigns are **created paused** — activation is the explicit money step; PRs never target the default branch; and the safe direction (pause, unpublish, close) is **always allowed**, no gate. Approval gates live only on publish/activate tools. This hardens ADR-007: the write tool must be structurally unable to do the dangerous thing.

### 4. MCP server channel + agent-native signup, in the roadmap (Q4)

Phase 3/4: expose the product as an MCP server — read tools by default; writes behind opt-in scopes; approval polling via a `get_action_approval` equivalent (redacted receipt); a missing integration returns a **one-click connect link** from the tool result itself (the capability degradation of ADR-008 with the UX attached); billing never bypassable via MCP. Plus agent-native signup (a single POST an agent can make) — cheap to build, markets itself.

### 5. Open questions as a first-class projection (Q5)

The console surfaces what the graph is *missing*: a projection over intents with low `structure_level`, rendered as questions (their plan asks: *"with paid spend capped at 0, should the roadmap remain fully organic?"*). Every answer writes a Decision via the brain, raising structure and unlocking autonomy. The approval inbox is "what awaits judgment"; open questions are "what awaits information".

### 6. `brand → agent endpoint` is a lookup, never a constant (Q6)

ADR-009's topology (agent as its own deployment behind a proxy) makes per-brand dedicated deployments possible as a future enterprise tier. The resolution of which agent deployment serves a brand is a lookup from day one, so the option never closes. (Their "dedicated server" claim is unverifiable marketing — plausibly one OpenClaw instance per customer, plausibly a shared row with a subdomain. If we ever offer isolation, ours will be mechanically real.)

## Consequences

- `packages/db`: `objects` gain the `evidence` type with citation keys; plan Objects pin their input set.
- `packages/brain`: `compilePlan(brandId)` — a pure derivation, no LLM; the `openQuestions` projection.
- `packages/policy`: reads `policy-override` Decisions; safe-direction actions are always allowed.
- Connectors: write/publish tool split; created-paused; no default-branch pushes.
- Console: policy switches UI, the open-questions surface, the plan page with Rebuild.
- Roadmap: MCP channel + agent-native signup (Phase 4); enterprise isolation stays open.
- ADR-004 amended in role: the CMO proposes Decisions and curates evidence ingredients; plans compile.

## Alternatives considered

- **CMO-authored plan Objects** — rejected: not rebuildable, inputs have no mechanical effect, and "why this item?" is answered with prose instead of data.
- **Policy as a settings table rendered as switches** — rejected: no provenance; switches write Decisions instead.
- **Approval gates on the write tool itself** — rejected: gates belong on publish/activate; the write tool must be unable to do the dangerous thing.
