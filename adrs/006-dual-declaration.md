# ADR-006: Dual materialization — declared subagents + standalone durable roots from a shared registry

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), grilling session with assisted analysis
- **Amends:** [ADR-004](004-extended-roster.md) — the roster is unchanged; the delegation mechanics change
- **Amended by:** [ADR-009](009-agent-deployment-and-console-data-surface.md) — the durable form of each root lives in its own eve app/deployment, not a shared multi-agent mount
- **Amended by:** [ADR-017](017-consultative-subagents-durable-root-work.md) — the declared subagent is now consultative and read-only; specialist-authored durable work runs only as a claimed named-root task
- **Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) — every durable agent task starts one terminal eve task-mode session; bounded lease retries remain retry-safe direct/automatic only
- **Amended by:** [ADR-019](019-human-approved-external-commitments.md) — human external commitments are pending direct tasks executed one-shot by the responsible root's plain code

## Context

Requirement: every specialist must be activatable **both** by the CMO (interactive path) **and** by deterministic mechanisms — schedules and the tasks-queue dispatcher (autonomous path).

Constraints established from the eve documentation:

- `schedules/` and channels are **root-only**: a declared subagent cannot have either. "Subagent also activatable deterministically" is not expressible with declared subagents alone.
- A multi-agent `withEve` mount can expose named agents under one deployment, but ADR-009 rejects that topology for this system: every durable root is a standalone eve application. Only the CMO accepts its `/eve/v1/*` session API in production; each specialist's standard channel is authenticated with `localDev()` alone.
- Declared subagents inherit nothing from the root; `defineState` is never shared between any two agents.
- Eve workspace extensions can package reusable skills, tools, connections, instruction fragments, and hooks for explicit mounting in either declaration. They cannot package agent config, sandboxes, schedules, custom channels, or nested extensions, so the two declarations remain real local wrappers rather than aliases for one runtime definition.
- Remote agents across deployments must run the same eve version to use agent messaging.

The options:

- **(a) Declared subagents only** — autonomous activation is impossible; the requirement fails.
- **(b) Standalone specialist roots only** — durable execution works, but the CMO loses low-latency local consultation and every question becomes asynchronous work.
- **(c) Dual materialization** — each specialist is generated twice from one shared definition: a local consultative subagent under the CMO and a durable wrapper in that specialist's standalone root app.

## Decision

> **Amended by ADR-009, ADR-017, ADR-018, and ADR-019.** Dual materialization remains, but the declarations are capability-asymmetric and do not share an eve deployment. The declared subagent advises locally inside the CMO app with a read-only surface; the standalone root performs one-shot durable agent work, retry-safe direct/automatic work, and one-shot human-approved commitments from claimed tasks. Shared registry identity no longer implies shared authority, tool composition, or process.

**Every specialist is declared twice, from a single shared definition:**

1. As a **declared subagent** inside `agent-cmo` — the interactive consultative path: in-process delegation, native control-plane events (`subagent.called/completed`), and recursive cancellation. Its read connections use already-established brand-owned grants; provider onboarding is an application flow, not a user-scoped Eve authorization parked inside the subagent.
2. As a **standalone durable root** in its own eve app and Vercel deployment — the task path: a machine-only `/internal/dispatch`, an authored standard channel available only through `localDev()` (with health still public), and no eve schedule. In production only the dispatcher may create specialist work; token-addressed framework callbacks may resume work that is already suspended.

Both materializations are thin wrappers over `packages/agents/registry.ts`: one map `name → { shared, consultation, durable }` consumed by the CMO's local subagent generator, the standalone root-app generator, each root's dispatcher, and the console. The registry is the only place where a specialist's shared shape is defined; hand-assembled copies are forbidden. Reusable eve contributions are delivered through workspace extension packages and mounted explicitly by the generated wrapper. Agent config, sandbox, channel, and root-only lifecycle files stay in the owning app. The consultative and durable forms intentionally compose different contracts and capabilities from that shared core (ADR-017).

Supporting decisions from the grilling session:

**Actor identity lives in the package, not the runtime session (G1).** An eve session knows the *principal* — who started the session (the human in chat, or `eve:app` for the dispatcher) — not the *agent* doing the work. Actor attribution therefore comes from the definition: `actorKey` is a build-time constant per specialist, and the brain's write tools are built by a factory closing over it (`brainToolsFor(actorKey)`). Two axes, two columns: `actions.actor_id` (the agent, from the package) and `intents.author_actor_id` (who authorized the work, from the session or the originating Decision). The subagent and root declarations of the same specialist write the same `actor_id`, so the responsibility query ("everything `seo` ever produced, and its verification track record") is one query across both paths.

> **Current actor rule (ADR-017):** both modes retain the same `actorKey` for identity and telemetry, but consultative subagents cannot create grammar Actions. Only durable root work writes specialist-authored `actions.actor_id` and Objects.

**Specialist routes are machine-only (G2).** Humans only ever address the CMO — the single transduction point where natural language becomes intents. `apps/app` proxies `/eve/v1/*` only to `agent-cmo`; standalone specialist roots accept task sessions exclusively from their own authenticated dispatcher path. The Policy matrix on the entry-path axis is one row: `human → cmo only`; `dispatcher → roots`.

**Typed payloads are Serie-A brief templates (G3).** Every task kind has a rich payload schema — objective, audience, constraints, prior artifacts, decision reference, acceptance criteria — validated at enqueue time in `packages/brain`. A task whose payload cannot support Serie-A work never enters the queue: structure unlocks autonomy, literally. Recurring work carries its template in the originating Decision; agent-booked follow-ups (`scheduleRecheck`) write their own payload with a human-visible rationale.

**Root/task compatibility is compiled, not guessed.** Each generated root wrapper derives `compiledSupportedKinds` from the task kinds assigned to that root in the registry. Its claim applies both `worker_key = SELF` and `kind IN compiledSupportedKinds` before any lifecycle mutation. During a staggered rollout, a task emitted by newer producer code therefore remains untouched until a compatible root deployment can claim it. Published task-kind contracts evolve only backward-compatibly; an incompatible contract is a new kind or uses an explicit expand-contract rollout.

**Autonomous spend is governed by a global Policy (Q2).** A per-plan, per-brand budget caps autonomous credit consumption. Decisions may only restrict it further, never expand it. Exceeding the budget is a hard stop, not an approval gate.

**The eval surface is doubled (G4, accepted).** Every specialist is evaluated in both invocation shapes: briefed-by-CMO and task-from-queue.

## Consequences

- ADR-004's "adding a specialist means adding a directory under `agent/subagents/`" becomes: **adding a specialist means adding an entry in `packages/agents/registry.ts`**; both declarations derive from it.
- All six specialist durable roots, including `growth`, are standalone deployments from the beginning. External agent messaging is not the CMO-to-root activation mechanism: durable work crosses the shared task queue, while the local declared subagent remains the consultative form.
- **All agent memory lives in the brain as Objects.** eve's never-shared state forces the grammar's discipline (Memory = persistent Objects produced by work) rather than merely encouraging it.
- Build verification checks that `agent-cmo` contains exactly the six generated consultative declarations, that each of the six specialist apps materializes exactly its own durable wrapper from the same registry entry, that every wrapper mounts only its generated extension set, and that every root's claim allowlist is generated from that wrapper's compiled task kinds.
- **Follow-ups resolved:** ADR-017 makes consultation read-only and routes all durable specialist work through tasks; ADR-018 makes every accepted agent task one terminal task-mode run; ADR-019 gives chat and autonomous roots one human-commitment path and one deterministic execution owner.

## Alternatives considered

Options (a) and (b) are covered in Context. A single multi-agent deployment was also considered and rejected by ADR-009: it is not the deployment boundary chosen for independently owned durable roots.
