# ADR-006: Dual materialization — declared subagents + standalone durable roots from a shared registry

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), grilling session with assisted analysis
- **Amends:** [ADR-004](004-extended-roster.md) — the roster is unchanged; the delegation mechanics change
- **Amended by:** [ADR-009](009-agent-deployment-and-console-data-surface.md) — the durable form of each root lives in its own eve app/deployment, not a shared multi-agent mount
- **Amended by:** [ADR-017](017-consultative-subagents-durable-root-work.md) — the declared subagent is now consultative and read-only; specialist-authored durable work runs only as a claimed named-root task
- **Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) — every durable agent task starts one terminal eve task-mode session; bounded lease retries remain retry-safe direct/automatic only
- **Amended by:** [ADR-019](019-human-approved-external-commitments.md) — human external commitments are pending direct tasks executed one-shot by the responsible root's plain code
- **Amended by:** [ADR-020](020-typed-decisions-and-impact-verification.md) — active Decisions are human-recorded; exact-Intent preauthorizations are the only Decision facts in task snapshots; Growth authors agentic impact Evidence and judgments

## Context

Requirement: every specialist must be activatable **both** by the CMO (interactive path) **and** by deterministic mechanisms — schedules and the tasks-queue dispatcher (autonomous path).

Constraints established from the eve documentation:

- `schedules/` and channels are **root-only**: a declared subagent cannot have either. "Subagent also activatable deterministically" is not expressible with declared subagents alone.
- A multi-agent `withEve` mount can expose named agents under one deployment, but ADR-009 rejects that topology for this system: every durable root is a standalone eve application. Only the CMO accepts its `/eve/v1/*` session API in production; each specialist's standard channel is authenticated with `localDev()` alone.
- Declared subagents inherit none of the root's authored slots or agent configuration; tools, hooks, model config, state, and other local declarations must be composed again, and `defineState` is never shared between two agents. Eve does propagate framework session context — including `auth.current`, `auth.initiator`, and parent lineage — into the child; that is trusted runtime context, not inherited authored configuration.
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

Both materializations are thin wrappers over `packages/agents/registry.ts`: one map `name → { shared, consultation, durable }` consumed by the CMO's local subagent generator, the standalone root-app generator, each root's dispatcher, and the console. The registry is the only place where a specialist's shared shape is defined; hand-assembled copies are forbidden. Reusable eve contributions are delivered through workspace extension packages and mounted explicitly by the generated wrapper. Agent config, sandbox, channel, and root-only lifecycle files stay in the owning app. Each model-bearing wrapper nevertheless calls the same plain-TypeScript model-config factory from `packages/agents`, because an extension cannot contribute `agent.ts`; that factory adds the trusted Gateway attribution without clobbering other provider options. The consultative and durable forms intentionally compose different contracts and capabilities from that shared core (ADR-017).

Supporting decisions from the grilling session:

**Actor identity lives in the package, not the runtime session (G1).** An eve session knows the *principal* — who started the session (the human in chat, or `eve:app` for the dispatcher) — not the *agent* doing the work. Actor attribution therefore comes from the definition: `actorKey` is a build-time constant per specialist, and durable brain-write tools close over it (`brainToolsFor(actorKey)`). Two axes, two columns: `actions.actor_id` names the producing agent, while `intents.author_actor_id` names the human or agent Actor that authored the Intent. An originating Decision, when present, uses a separate typed relation rather than an Actor FK. Consultative and durable declarations share the same registry identity for telemetry and attribution, but only durable root work can create specialist-authored canonical Actions or Objects (ADR-017).

Human Intent transduction is the narrow place where principal, author, and producing agent deliberately remain distinct. The interactive CMO wrapper may expose the trusted human-declaration and criteria/constraint-refinement boundaries only in a top-level turn bound to an application-owned CMO conversation whose current authenticated caller still has role `owner | admin | member`. A declaration creates an `active` revision-1 Intent under the human author; a refinement preserves that immutable author. In both cases the transducing Action uses the CMO's build-time Actor and records the current human authorizer plus trusted conversation/session/turn/call provenance. The model supplies only the typed Intent mutation fields, never Actor, Member role, status, creator mode, or provenance. An autonomous root wrapper exposes only `proposeIntent`, which creates an agent-authored `draft`; task-mode roots, self-copies, consultative declarations, and system Actors expose no interactive-refinement branch.

> **Current actor rule (ADR-017):** both modes retain the same `actorKey` for identity and telemetry, but consultative subagents cannot create grammar Actions. Only durable root work writes specialist-authored `actions.actor_id` and Objects.

This rule governs agent attribution only. A deterministic application integration that is itself the content producer uses its own exact trusted `type = system` Actor (for example `system:context-dev`) and never borrows a specialist `actorKey`; each such Actor is deny-by-default and resolvable only by its dedicated operation. ADR-019's registered direct handler is different: it executes outside Eve on behalf of the responsible specialist root, so its terminal Result Action uses that root's registry Actor. Decision-impact measurement runs inside Growth's one-shot Eve task, so its Evidence and Verification use the Growth agent Actor instead.

**Specialist routes are machine-only (G2).** Humans only ever address the CMO — the single transduction point where natural language becomes intents. `apps/app` proxies `/eve/v1/*` only to `agent-cmo`; standalone specialist roots accept task sessions exclusively from their own authenticated dispatcher path. The Policy matrix on the entry-path axis is one row: `human → cmo only`; `dispatcher → roots`.

**Typed briefs have a common origin envelope plus a kind payload (G3).** `packages/brain` owns the trusted discriminated origin: an `IntentSnapshot` with exact revision, statement, criteria, constraints and applicable exact-Intent preauthorization facts; exact Plan/Move references for Plan-routed work; or a registered origin-free branch. Every task kind separately owns its rich payload schema for audience, prior artifacts, execution parameters, and output-specific data. Roadmap, model and brand-restriction Decision heads have separate consumers and never enter an Intent snapshot. The caller cannot duplicate or override common origin fields in the payload. The one narrow model-visible selector is the interactive CMO's candidate `intent_id`: it expresses the CMO's semantic reading of the current human request, but trusted code still reloads that exact same-brand active Intent and alone constructs the origin envelope. No task/autonomous payload can select an origin. Both schemas are validated at enqueue/reload time, so structure unlocks autonomy literally without making queued work depend on a later canonical edit. A recurring `schedules` template carries its registered origin recipe. A task's staged `next_*` tuple carries only typed payload, due time, and rationale; successful materialization derives the origin from the authoritative source task. An Intent-bound insertion snapshots the latest canonical revision, while a Plan-routed successor retains null Intent and its exact Plan/Move pair; replay, reschedule, or active-work observation preserves the origin already accepted by an existing task.

**Root/task compatibility is compiled, not guessed.** Each generated root wrapper derives `compiledSupportedKinds` from the task kinds assigned to that root in the registry. Its claim applies both `worker_key = SELF` and `kind IN compiledSupportedKinds` before any lifecycle mutation. During a staggered rollout, a task emitted by newer producer code therefore remains untouched until a compatible root deployment can claim it. Published task-kind contracts evolve only backward-compatibly; an incompatible contract is a new kind or uses an explicit expand-contract rollout.

**Autonomous spend is governed by a global Policy (Q2).** A per-plan, per-brand allowance is a best-effort admission threshold for new autonomous sessions. Current brand `policy_restriction` Decision heads may only restrict it further, never expand it. Once the recorded balance is zero or negative, new agent claims stop rather than opening an approval gate. Costs are known only after model calls and independently scaled roots may admit work concurrently, so already-started sessions can overshoot the threshold and drive the ledger negative; v1 deliberately adds no reservation/hold protocol and does not market this as an exact hard cap.

**The eval surface is doubled (G4, accepted).** Every specialist is evaluated in both invocation shapes: briefed-by-CMO and task-from-queue.

## Consequences

- ADR-004's "adding a specialist means adding a directory under `agent/subagents/`" becomes: **adding a specialist means adding an entry in `packages/agents/registry.ts`**; both declarations derive from it.
- All six specialist durable roots, including `growth`, are standalone deployments from the beginning. External agent messaging is not the CMO-to-root activation mechanism: durable work crosses the shared task queue, while the local declared subagent remains the consultative form.
- **All durable product memory lives in the brain as Objects.** Eve session state remains working/runtime memory; anything meant to survive or inform later work is a canonical Object with provenance.
- Build verification checks that `agent-cmo` contains exactly the six generated consultative declarations, that each of the six specialist apps materializes exactly its own durable wrapper from the same registry entry, that every model-bearing wrapper calls the shared attribution-aware model-config factory, that every wrapper mounts only its generated extension set, and that every root's claim allowlist is generated from that wrapper's compiled task kinds.
- **Follow-ups resolved:** ADR-017 makes consultation read-only and routes all durable specialist work through tasks; ADR-018 makes every accepted agent task one terminal task-mode run; ADR-019 gives chat and autonomous roots one human-commitment path and one deterministic execution owner.

## Alternatives considered

Options (a) and (b) are covered in Context. A single multi-agent deployment was also considered and rejected by ADR-009: it is not the deployment boundary chosen for independently owned durable roots.
