# ADR-015 — The registry: uniform agent shape, two-declaration deltas, self-copies, tool composition, task kinds, capability gating, the console as consumer

**Status:** Accepted — 2026-08-06
**Amends:** ADR-006 (what the shared definition contains), ADR-012 (the return contract is eve's `outputSchema`)
**Refs:** ADR-004, ADR-009, ADR-011, ADR-013; eve bundled docs (`subagents.mdx`, `schedules.mdx`, `concepts/execution-model-and-durability.mdx`)

## Context

Grilling round on `packages/agents` — the last big contract not yet opened. Grounded in eve's actual subagent mechanics, which settled several questions by themselves: declared subagents inherit **nothing** from the root (absent slots fall back to framework defaults), channels and schedules are root-only, a subagent's tool surface is `{ message, outputSchema? }`, and named agents in a multi-agent mount get `/eve/agents/<name>` automatically.

## Decisions

### D1 — Uniform shape: the CMO is a registry entry too

Every agent — lead included — is one registry entry:

```text
{ actorKey, slug, role: lead | specialist, instructions, skills[], tools,
  connections, modelDefaults, egress, taskKinds[] }
  + delegationTargets[] (lead)  + lateralEdges[] (specialists)
```

The CMO has task kinds like anyone else (the daily brief, ADR-011 D2). One loader, no special cases; adding an eighth specialist is adding an entry.

### D2 — The two declarations share a core and differ in three declared deltas

- **Subagent declaration**: no channels, no schedules (root-only in eve); the brief arrives in the delegation `message`; the return is eve's `outputSchema` task mode — the ADR-012 return contract is enforced by the framework, not by the prompt.
- **Root declaration**: internal dispatch channel (the CRM pattern), brief as task payload, return via brain writes + task completion.
- **Instructions**: `core` + short per-mode addenda (`asSubagent`: reports to the CMO, terse; `asRoot`: autonomous stance, writes for digest and inbox). Gate behavior stays mechanical per principal (ADR-007); the addendum is communication stance, not policy.

The materialization script generates both directories from one entry.

### D3 — Self-copies are intra-session parallelism, enabled uniformly

The built-in `agent` tool does not spawn independent agents — it is a tool the agent calls inside its own session, and the copy runs as a child of an already-dispatched, already-budgeted, already-traced session. There is no queue to bypass: **the queue governs parallelism across work items** (N tasks → N dispatched sessions), while **self-copies govern parallelism within one work item** (a specialist analyzing ten URLs in parallel during one audit; the CMO running research fan-out or a `marketing-council` deliberation).

- Enabled on the CMO and on specialist roots alike — one rule, no special cases.
- eve's mechanical bounds apply everywhere: copies cannot call `agent` (no recursion), and copies share the parent's sandbox, so every agent's instructions require non-overlapping write scopes.
- Specialist copies are **leaf parallelism by construction**: no nested subagents are authored, so a specialist copy has nothing to delegate to.
- CMO copies inherit the declared-specialist tool surface; their delegations pass the ADR-011 in-flight guard like any other.
- Budget attribution rolls up the session tree: child sessions are metered to the same brand pool (`session_charge` per session, ADR-014 D5), and the pool check gates new work at dispatch (ADR-011 D4).

### D4 — Tool composition is mechanical from the registry

Because declared subagents inherit nothing, each generated directory must contain everything it needs:

- `coreBrainTools` (every agent): `get_brand_context`, `produce_object`, `propose_decision`, `record_evidence`, `schedule_recheck`, …
- `specialistTools[slug]`: the specialist's authored tools
- `connections[slug]`: MCP connections with per-connection tool allowlists

An agent physically lacks tools outside its entry. Combined with ADR-013 (writes only via app-runtime tools), "every boundary action passes through the Policy" becomes: the Policy knows every tool that exists, because it assigned them.

### D5 — Task kinds are first-class registry citizens

```text
{ kind, specialist, briefSchema (zod), outputContract (producible Object types),
  subjectKey: (payload) → string,     // the dedup key (ADR-014)
  modelOverride?, budgetClass,        // session budget sizing (ADR-011 D4)
  requires: capability[],             // see D6
  schedulableBy: agent | decision | human }
```

The dispatcher validates payloads at enqueue with `briefSchema`, derives `subject_key` from the declared function, sizes the session budget from `budgetClass`. If a task kind is not in the registry, it does not exist.

### D6 — Capability gating at the finest grain: task kinds and tools, never whole agents

Gating a whole specialist on a missing connection is the wrong granularity (`lifecycle` does churn analysis with no connection and newsletters with Resend). Two fine grains instead:

- **Task kinds** declare `requires[]`; the dispatcher checks at lease time — unmet requirements leave the task queued and the console counter shows "N jobs waiting on Resend" (ADR-009).
- **Capability-bound tools** are `defineDynamic` per session: a missing capability omits the tool from the session surface; in interactive sessions eve's `authorization.required` OAuth challenge doubles as Magister's `get_connect_link`. The specialist stays available, does the rest of its work, and reports the blocker via the return contract's `open_questions`.

The registry declares the universe (code); per-brand enablement is data (a projection over Decisions + connected capabilities).

### D7 — The console is the registry's third consumer

`apps/app` imports the registry for the team page (roster, owns, skills), capability counters, policy-UI categories, and the plan page. Therefore `packages/agents` is isomorphic: no Node-only APIs at import time (zod schemas are fine). One source, three consumers: subagent declaration, root declarations, console UI.

## Notes

- Redeploys change standing sessions at the next turn (eve adopts the deployment's current instructions, model, and tools). No pinning — consistent with the rejected `skill_snapshot` (ADR-011): code is code.
- Subagent names live in the same namespace as tool names; a collision is a build error. Naming convention: specialist slugs stay distinct from tool names.
