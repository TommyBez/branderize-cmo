# ADR-006: Dual declaration — declared subagents + named root agents from a shared registry

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), grilling session with assisted analysis
- **Amends:** [ADR-004](004-extended-roster.md) — the roster is unchanged; the delegation mechanics change

## Context

Requirement: every specialist must be activatable **both** by the CMO (interactive path) **and** by deterministic mechanisms — schedules and the tasks-queue dispatcher (autonomous path).

Constraints established from the eve documentation:

- `schedules/` and channels are **root-only**: a declared subagent cannot have either. "Subagent also activatable deterministically" is not expressible with declared subagents alone.
- `withEve` embeds **multiple named agents** in one Next.js deployment; each gets its own `/eve/agents/<name>` route prefix and its own cron entries in the build output.
- Declared subagents inherit nothing from the root; `defineState` is never shared between any two agents.
- Remote agents across deployments must run the same eve version to use agent messaging.

The options:

- **(a) Declared subagents only** — autonomous activation is impossible; the requirement fails.
- **(b) Named root agents only, with the CMO delegating via remote-agent calls into the same deployment** — pays remote costs (HTTP self-calls, OIDC plumbing, version-skew constraints) in exchange for an operational isolation that does not exist within a single deployment.
- **(c) Dual declaration** — each specialist declared twice from one shared definition.

## Decision

**Every specialist is declared twice, from a single shared definition:**

1. As a **declared subagent** under the CMO — the interactive path: in-process delegation, native control-plane events (`subagent.called/completed`, proxied `authorization.required`), recursive cancellation.
2. As a **named root agent** in the same deployment — the deterministic path: own `schedules/`, own inbound routes, activatable by the tasks-queue dispatcher.

Both declarations are thin wrappers over `packages/agents/registry.ts`: one map `name → { definition, actorKey, routingDescription, taskKinds, directActivationPolicy }` consumed by exactly three parties — the CMO's subagent wrappers, the named root agents, and the queue dispatcher. The registry is the only place where a specialist's shape is defined; hand-assembled copies are forbidden.

Supporting decisions from the grilling session:

**Actor identity lives in the package, not the runtime session (G1).** An eve session knows the *principal* — who started the session (the human in chat, or `eve:app` for the dispatcher) — not the *agent* doing the work. Actor attribution therefore comes from the definition: `actorKey` is a build-time constant per specialist, and the brain's write tools are built by a factory closing over it (`brainToolsFor(actorKey)`). Two axes, two columns: `actions.actor_id` (the agent, from the package) and `intents.author_actor_id` (who authorized the work, from the session or the originating Decision). The subagent and root declarations of the same specialist write the same `actor_id`, so the responsibility query ("everything `seo` ever produced, and its verification track record") is one query across both paths.

**Specialist routes are machine-only (G2).** Humans only ever address the CMO — the single transduction point where natural language becomes intents. Named specialist agents accept sessions exclusively from the dispatcher principal (`eve:app`). The Policy matrix on the entry-path axis is one row: `human → cmo only`; `dispatcher → specialists`.

**Typed payloads are Serie-A brief templates (G3).** Every task kind has a rich payload schema — objective, audience, constraints, prior artifacts, decision reference, acceptance criteria — validated at enqueue time in `packages/brain`. A task whose payload cannot support Serie-A work never enters the queue: structure unlocks autonomy, literally. Recurring work carries its template in the originating Decision; agent-booked follow-ups (`scheduleRecheck`) write their own payload with a human-visible rationale.

**Autonomous spend is governed by a global Policy (Q2).** A per-plan, per-brand budget caps autonomous credit consumption. Decisions may only restrict it further, never expand it. Exceeding the budget is a hard stop, not an approval gate.

**The eval surface is doubled (G4, accepted).** Every specialist is evaluated in both invocation shapes: briefed-by-CMO and task-from-queue.

## Consequences

- ADR-004's "adding a specialist means adding a directory under `agent/subagents/`" becomes: **adding a specialist means adding an entry in `packages/agents/registry.ts`**; both declarations derive from it.
- **Graduation path to a true remote deployment** (the `growth` specialist with ad-platform credentials, Phase 4): the local subagent declaration is replaced by `defineRemoteAgent` in the CMO's config and the named agent moves to its own deployment — the registry is the single point of change. The eve constraint applies: agent messaging requires the same eve version on both deployments.
- **All agent memory lives in the brain as Objects.** eve's never-shared state forces the grammar's discipline (Memory = persistent Objects produced by work) rather than merely encouraging it.
- **Phase 0 verification item**: the exact multi-agent mounting convention of `withEve` (file layout for named agents) must be confirmed against the eve compiler before building on it.
- **Open follow-ups**, recorded for the next decisions: concurrency between the two activation paths (Q3), and parked-approval vs queue-lease semantics (Q4).

## Alternatives considered

Options (a) and (b) are covered in Context. Option (b) was the initially recommended path during analysis and was rejected through the grilling: within one deployment it pays the full cost of remoteness for zero actual isolation.
