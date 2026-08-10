# ADR-012 — Contracts: one approval source, the brief schema, the intent lifecycle, plan-compiler inputs

**Status:** Accepted — 2026-08-05
**Amends:** ADR-007 (the inbox's single source), ADR-010 (compiler inputs)
**Amended by:** [ADR-017](017-consultative-subagents-durable-root-work.md) (D1: no parked specialist consultation; D2: split consultation and durable contracts)
**Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) (D4: `finishTask` stages the return and `session.completed` is the terminal success boundary)
**Amended by:** [ADR-019](019-human-approved-external-commitments.md) (D1: the single inbox source is `tasks.status = 'awaiting_approval'`; no external commitment parks an eve session)
**Refs:** ADR-002, ADR-006, ADR-011, ADR-016, ADR-018; current trycompai/crm `AgentRun` and staged `finish_run` boundary; Magister (impact baselines); context.dev (onboarding data)

## Context

Second self-grilling round, aimed one level down: not "do the ADRs compose?" but "do the contracts between the pieces hold when written in code?". Four decisions were approved; three further questions (policy matrix, specialist chaining, sandbox rules) were sent back for deeper reasoning and are handled separately.

## Decisions

### D1 — One source of truth for "what awaits judgment"

> **Amended by ADR-017 and ADR-019.** The one-inbox rule remains, but its source is now the execution identity itself: human-activation direct tasks in `awaiting_approval`.

ADR-007 left two places where pending human judgment could live: eve session state and proposal Objects. Both are rejected for external commitments.

Rule: interactive CMO chat and autonomous durable roots call the same typed preparation service, which creates a distinct direct task in `awaiting_approval`. The inbox is a query over those tasks. Approving from chat or inbox invokes the same `approveTask` transaction, appends one Approval Action, and queues the same row. The CMO conversation need not remain parked, and no resumed eve tool may execute the provider call (ADR-019).

### D2 — The brief contract, and the return contract

> **Amended by ADR-017.** The schema below is now the durable task/root `TaskCompletion` contract. A declared subagent instead uses a configured `ConsultationReturn` with summary, recommendations, source references, suggested work, and open questions — no produced Object ids or claimed follow-up tasks. A promoted consultation becomes a validated durable task with bounded conversational context; the consultation result itself is not canonical evidence.

"Self-contained brief" is now a schema, not a phrase. Each task kind in `packages/agents` declares a zod schema:

```text
brief:    { intent_id, brand_id, preamble_extract (size-capped), object_ids[],
            constraints (from active Decisions), capabilities_snapshot,
            session_budget, output_contract, due_at }
return:   { status (completed | partial | blocked), summary (token-capped),
            produced_object_ids[], follow_up_task_ids[], open_questions[] }
```

Artifacts travel by id, never by content. The `output_contract` declares which Object types the session may produce, and the brain's write path rejects anything else. The return contract keeps the CMO's context small: a summary plus references, never full artifact bodies.

`capabilities_snapshot` is input to agent planning, not a pin on a later commitment. ADR-019's deterministic executor resolves the brand's current active connection at execution time and records the effective provider account in the Result Action receipt.

`follow_up_task_ids` contains only lateral or immediate follow-up tasks that already exist when `finishTask` runs. A self-recheck staged in the current row's `next_*` tuple has no task id yet and is intentionally omitted; successful settlement later creates or observes its successor atomically and exposes that resulting id through task state.

For a durable agent task, the authored `finishTask` tool obtains `task_id` from trusted eve context, validates the registered return schema, and stages the canonical result without settling the row. The root returns the same schema through its configured output contract, but `result.completed` is telemetry and cannot overwrite the staged value; a mismatch is diagnostic. `session.completed` with the staged value is the normal success trigger. Every declared status — `completed`, `partial`, or `blocked` — is a considered domain outcome under execution status `succeeded`. A delivery error, `turn.failed`, `session.failed`, application cancellation, or terminal completion without a valid staged result is a terminal technical failure, never a synthetic `blocked` outcome or an automatic retry of the same run. A failed terminal-event projection is reconciled manually from the durable stream rather than by redispatching the agent.

### D3 — The intent lifecycle

`intents.status`: `draft → active → settled | abandoned`.

- Decomposition (`parent_intent_id`) is an Action open to any actor — human, CMO, or durable specialist root (via follow-up tasks) — always with rationale, always in the graph. A consultative subagent may only suggest the follow-up to the CMO.
- Closing an intent requires human settlement or a Verification attesting the acceptance criteria.
- `abandoned` deletes nothing: Objects and provenance survive.
- An `active` intent with no queued tasks and no recent actions surfaces in open questions — a forgotten intent is a structure hole, exactly like a Decision without a verification plan (ADR-011 D3).

### D4 — What the plan compiler consumes

The compiler is mechanical, so its inputs must be contractual. Two typed Object kinds:

```text
evidence:        { key, kind, metric?, score?, data }
move_candidate:  { key, title, evidence_keys[], effort, impact_class, funnel_stage }
```

Durable specialist-root sessions produce both (LLM proposes); the compiler filters move candidates by active Decisions (guardrails), orders by the strategy Decision, groups by funnel stage, and versions the result (mechanics dispose). A move candidate citing a nonexistent evidence key is discarded — the same citation-validation rule as the digest renderer (ADR-011 D2).

## Onboarding data: context.dev

First-pass onboarding data comes from **context.dev** (The Web Context API): the Brand API resolves a domain into logos, colors, fonts, styleguides, socials, and industry codes, and the crawl/scrape APIs turn the site into markdown — exactly the "fetch the site, extract the brand kit" step of the onboarding loop, without building crawlers. It is also available as MCP, so it fits the connector model with scoped, metered access. The user interview remains for what the web cannot tell: goals, taste, constraints.
