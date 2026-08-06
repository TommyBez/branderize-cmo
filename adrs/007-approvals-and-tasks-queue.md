# ADR-007: Approvals and the tasks queue — park on interactive, deny-and-propose on autonomous

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), grilling session with assisted analysis
- **Builds on:** [ADR-006](006-dual-declaration.md) (two activation paths), [ADR-002](002-postgres-work-graph.md) (work graph substrate)

## Context

Two questions were left open by the ADR-006 grilling:

- **Q3 — Concurrency between the two activation paths**: the CMO delegates a specialist for brand X (interactive) while a schedule fires the same specialist for brand X (autonomous).
- **Q4 — Parked approvals vs queue lease**: an autonomous run parking for hours at an approval gate while its task lease expires, causing a second dispatcher to re-lease and double-execute the work.

Code analysis of [trycompai/crm](https://github.com/trycompai/crm) (`apps/agent/agent/lib/{approval,tasks,dispatch,evidence,pool}.ts`) shows they **eliminated** both problems structurally rather than managing them:

- `approval.ts` — principal-aware gates: automated sessions get boundary writes **denied** with an "instead" instruction (`"Not something to do unattended."`); interactive sessions get `user-approval`. Automated sessions never park, so leases stay bounded (10/30 min) and the park-vs-lease conflict cannot exist.
- `tasks.ts` — `scheduleTask` **upserts per (kind, subject)**: duplicate follow-ups cannot be enqueued. `claimDue` leases with `FOR UPDATE SKIP LOCKED`; `MAX_ATTEMPTS = 3` with `retireExhausted` for poison tasks.
- `dispatch.ts` — **two lanes**: `DIRECT_KINDS` are executed deterministically inside the dispatcher (plain code, no LLM); research kinds become agent sessions via channel `receive`. Retry briefs say *"carry on from what is already in this thread"* and the channel dispatches the same task-derived key.
- `evidence.ts` — writes are **weighted by evidence kind**; a `contradiction` caps the score and the fact degrades to a human-settled suggestion. The write path arbitrates conflicts, not locks.
- `pool.ts` — `collapsing()` prevents overlapping dispatcher runs.

## Decision

**Approval semantics differ per activation path.**

- *Interactive path* (human present, chatting with the CMO): eve-native approval with parked sessions. The wait is short and the resume is seamless.
- *Autonomous path* (dispatcher principal `eve:app`): boundary actions are **denied with an instruction naming the alternative**. The specialist completes everything up to the boundary, saves a fully-composed, ready-to-execute **proposal as an Object** (`type: proposal` — the composed Resend broadcast, the drafted Typefully queue), and exits. No session ever parks unattended; automated runs always terminate.

**Approval is a separate Action that triggers mechanical execution.** A human approval in the console settles the proposal and enqueues an `execute-proposal` task — the deterministic lane (no LLM) performing exactly the approved boundary call with the approved payload. Intelligence before the gate, mechanics after it. The approval inbox is therefore a query over pending proposal Objects, not over parked sessions.

**The tasks queue** adopts the CRM mechanics:

- Dedup at enqueue: upsert per `(kind, brand_id, subject)` — duplicate follow-ups cannot exist
- Lease with `FOR UPDATE SKIP LOCKED`; bounded leases; max attempts with retirement
- Retry continuity: the retry reuses the same task identity and references prior artifacts instead of treating the attempt as unrelated work
- Two lanes: agent tasks (the dispatcher starts a specialist session) and `execute-proposal` tasks (deterministic code)

**Concurrency on writes is optimistic, on the supersession chain.** `produceObject` declares which Object version it intends to supersede; if the head has moved meanwhile, the write becomes a branch requiring human resolution (a Verification). Single-owner Objects (brand context → product-marketer) plus enqueue dedup make the dangerous case rare by construction. Claim grading (`proven / plausible / assumption`) plays the role of the CRM's evidence weighting: conflicts degrade to human review instead of corrupting state.

## Consequences

- `packages/policy` gains the principal-aware approval factory: (effect signature × principal) → allowed / park-and-ask / denied-with-instruction.
- `packages/brain`: proposals are Objects; approvals are Actions; `execute-proposal` is the only way a boundary call happens for autonomous work.
- The console's approval inbox renders proposal Objects with their `policy_snapshot` — "why am I being asked?" is always answerable.
- **Recorded honestly — what the CRM does *not* solve for us**: they run one agent, not a team (no lead→specialist overlap); boundary actions are rare for a research CRM, while for a marketing team they are the product itself. Our proposal Objects must therefore be complete deliverables, not notes — which is exactly what ADR-006's Serie-A payload rule (G3) already demands.

## Alternatives considered

- **eve-native parking for both paths** — rejected: unattended parked sessions conflict with bounded leases and create double-execution risk; sessions parked for days are an operational smell the CRM avoids by construction.
- **Mutex per (specialist, brand)** — rejected: lock ownership across parked/long sessions is fragile; optimistic supersession + dedup achieves the same safety without lock lifetime questions.
- **All activations through the queue (including the CMO's interactive delegation)** — rejected: unifies the paths but puts asynchronous queue latency between the user and a chat answer.
