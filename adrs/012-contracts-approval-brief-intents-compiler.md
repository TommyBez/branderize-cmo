# ADR-012 — Contracts: one approval source, the brief schema, the intent lifecycle, plan-compiler inputs

**Status:** Accepted — 2026-08-05
**Amends:** ADR-007 (the inbox's single source), ADR-010 (compiler inputs)
**Refs:** ADR-002, ADR-006, ADR-011; trycompai/crm (continuation tokens); Magister (impact baselines); context.dev (onboarding data)

## Context

Second self-grilling round, aimed one level down: not "do the ADRs compose?" but "do the contracts between the pieces hold when written in code?". Four decisions were approved; three further questions (policy matrix, specialist chaining, sandbox rules) were sent back for deeper reasoning and are handled separately.

## Decisions

### D1 — One source of truth for "what awaits judgment"

ADR-007 left two places where pending human judgment could live: eve session state (interactive parks) and proposal Objects (autonomous path). That would make the approval inbox a union of two stores — a query with two semantics.

Rule: when an interactive session parks at a gate, the write path **still materializes a proposal Object** (`status='proposed'`), and the eve approval references it. The inbox is `objects WHERE status='proposed'` — one store, one semantics. Approving from the inbox or from the chat is the same Action on the same Object; the parked session resumes when the proposal settles (the CRM's continuation-token pattern).

### D2 — The brief contract, and the return contract

"Self-contained brief" is now a schema, not a phrase. Each task kind in `packages/agents` declares a zod schema:

```text
brief:    { intent_id, brand_id, preamble_extract (size-capped), object_ids[],
            constraints (from active Decisions), capabilities_snapshot,
            session_budget, output_contract, due_at }
return:   { summary (token-capped), produced_object_ids[],
            follow_up_tasks[], open_questions[] }
```

Artifacts travel by id, never by content. The `output_contract` declares which Object types the session may produce, and the brain's write path rejects anything else. The return contract keeps the CMO's context small: a summary plus references, never full artifact bodies.

### D3 — The intent lifecycle

`intents.status`: `draft → active → settled | abandoned`.

- Decomposition (`parent_intent_id`) is an Action open to any actor — human, CMO, or specialist (via follow-up tasks) — always with rationale, always in the graph.
- Closing an intent requires human settlement or a Verification attesting the acceptance criteria.
- `abandoned` deletes nothing: Objects and provenance survive.
- An `active` intent with no queued tasks and no recent actions surfaces in open questions — a forgotten intent is a structure hole, exactly like a Decision without a verification plan (ADR-011 D3).

### D4 — What the plan compiler consumes

The compiler is mechanical, so its inputs must be contractual. Two typed Object kinds:

```text
evidence:        { key, kind, metric?, score?, data }
move_candidate:  { key, title, evidence_keys[], effort, impact_class, funnel_stage }
```

Specialist sessions produce both (LLM proposes); the compiler filters move candidates by active Decisions (guardrails), orders by the strategy Decision, groups by funnel stage, and versions the result (mechanics dispose). A move candidate citing a nonexistent evidence key is discarded — the same citation-validation rule as the digest renderer (ADR-011 D2).

## Onboarding data: context.dev

First-pass onboarding data comes from **context.dev** (The Web Context API): the Brand API resolves a domain into logos, colors, fonts, styleguides, socials, and industry codes, and the crawl/scrape APIs turn the site into markdown — exactly the "fetch the site, extract the brand kit" step of the onboarding loop, without building crawlers. It is also available as MCP, so it fits the connector model with scoped, metered access. The user interview remains for what the web cannot tell: goals, taste, constraints.
