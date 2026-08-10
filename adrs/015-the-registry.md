# ADR-015 — The registry: uniform agent shape, two-declaration deltas, self-copies, tool composition, task kinds, capability gating, the console as consumer

**Status:** Accepted — 2026-08-06
**Amends:** ADR-006 (what the shared definition contains), ADR-012 (the return contract is eve's `outputSchema`)
**Amended by:** [ADR-017](017-consultative-subagents-durable-root-work.md) (D1–D6: capability-asymmetric modes, self-copy inheritance, tool composition, durable task entry, and capability gating)
**Amended by:** [ADR-018](018-one-shot-durable-agent-tasks.md) (D5: agent task kinds execute once in task mode and finish through staged `TaskCompletion`)
**Amended by:** [ADR-019](019-human-approved-external-commitments.md) (D4–D6: closed preparation/commitment variants, human activation, one-shot external direct execution, and preview/policy derivation)
**Refs:** ADR-004, ADR-009, ADR-011, ADR-013; eve 0.31.3 bundled docs (`subagents.mdx`, `extensions.md`, `schedules.mdx`, `concepts/execution-model-and-durability.mdx`)

## Context

Grilling round on `packages/agents` — the last big contract not yet opened. Grounded in eve's actual subagent mechanics, which settled several questions by themselves: declared subagents inherit **nothing** from the root (absent slots fall back to framework defaults), channels are root-only, and a subagent's tool surface is `{ message, outputSchema? }`. ADR-009 subsequently fixed the deployment shape: the CMO and six durable specialist roots are seven standalone eve apps, not one multi-agent mount, and scheduling is a Next.js cron poke rather than an eve schedule.

## Decisions

### D1 — Uniform shape: the CMO is a registry entry too

> **Amended by ADR-017.** Uniform identity remains, but a specialist entry now has `shared`, `consultation`, and `durable` composition. Tools, connections, sandbox/egress policy, and return contracts are mode-specific rather than one flat surface.

Every agent — lead included — is one registry entry:

```text
{ actorKey, slug, role: lead | specialist, instructions, skills[], tools,
  connections, modelDefaults, egress, taskKinds[] }
  + delegationTargets[] (lead)  + lateralEdges[] (specialists)
```

The CMO has task kinds like anyone else (the daily brief, ADR-011 D2). One loader, no special cases; adding another specialist is adding an entry and generating its standalone durable-root app.

### D2 — The two declarations share a core and differ in three declared deltas

> **Amended by ADR-009 and ADR-017.** The declarations still share identity, instructions, skills, and model defaults, but also differ mechanically in authority, tool/connection surface, contract, and deployment. The subagent is read-only consultation inside `agent-cmo`; the standalone root is durable task execution. eve's caller-selectable `outputSchema` is not an authorization boundary. The historical three-delta formulation follows.

- **Subagent declaration**: no channels, no schedules (root-only in eve); the brief arrives in the delegation `message`; the return is eve's `outputSchema` task mode — the ADR-012 return contract is enforced by the framework, not by the prompt.
- **Root declaration**: internal dispatch channel (the CRM pattern), brief as task payload, return via brain writes + task completion.
- **Instructions**: `core` + short per-mode addenda (`asSubagent`: reports to the CMO, terse; `asRoot`: autonomous stance, writes for digest and inbox). Gate behavior stays mechanical per principal (ADR-007); the addendum is communication stance, not policy.

The materialization step generates the specialist's local consultative definition inside `agent-cmo` and its durable wrapper inside that specialist's standalone root app from one entry. It also mounts their explicitly selected workspace extensions. Reusable skills, tools, connections, instruction fragments, and hooks may live in those extensions; agent config, sandbox, schedules, and custom channels stay in the generated local wrapper because eve extensions cannot provide them.

### D3 — Self-copies are intra-session parallelism, enabled uniformly

> **Amended by ADR-017.** A CMO copy inherits the same two mechanisms as the CMO: non-deduplicated read-only specialist consultation and the authored durable-work tool. There is no pre-delegation subagent guard. Concurrent durable requests coalesce at the Postgres task constraint. A specialist-root copy inherits its root's work surface and remains inside the same dispatched task; no copy widens authority. The historical equal-surface description follows.

The built-in `agent` tool does not spawn independent agents — it is a tool the agent calls inside its own session, and the copy runs as a child of an already-dispatched, already-budgeted, already-traced session. There is no queue to bypass: **the queue governs parallelism across work items** (N tasks → N dispatched sessions), while **self-copies govern parallelism within one work item** (a specialist analyzing ten URLs in parallel during one audit; the CMO running research fan-out or a `marketing-council` deliberation).

- Enabled on the CMO and on specialist roots alike — one rule, no special cases.
- eve's mechanical bounds apply everywhere: copies cannot call `agent` (no recursion), and copies share the parent's sandbox, so every agent's instructions require non-overlapping write scopes.
- Specialist copies are **leaf parallelism by construction**: no nested subagents are authored, so a specialist copy has nothing to delegate to.
- CMO copies inherit the declared-specialist tool surface; their delegations pass the ADR-011 in-flight guard like any other.
- Budget attribution rolls up the session tree: child sessions are metered to the same brand pool (`session_charge` per session, ADR-014 D5), and the pool check gates new **agent-session** work at dispatch (ADR-011 D4). It is not a generic gate on deterministic direct claims.

### D4 — Tool composition is mechanical from the registry

> **Amended by ADR-017 and ADR-019.** `coreBrainTools (every agent)` is no longer current. Registry generation produces `consultTools` (brain reads and allowlisted external reads) for declared specialists and `workTools` for standalone roots. Root work tools include brain writes, scheduling/lateral enqueue, preparation of human-activation tasks, and only explicitly registered create-only external drafts. Every external-draft operation declares replay semantics as `idempotent`, `recoverable`, or `duplicate-safe`; materialization rejects an unclassified operation. External commitment handlers are plain-code direct executors and are never placed on a model-visible tool surface.

Because declared subagents inherit nothing implicitly, each generated declaration must compose everything it needs, either locally or through an explicit workspace-extension mount:

- `coreBrainTools` (every agent): `get_brand_context`, `produce_object`, `propose_decision`, `record_evidence`, `schedule_recheck`, …
- `specialistTools[slug]`: the specialist's authored tools
- `connections[slug]`: MCP connections with per-connection tool allowlists

The registry selects these contributions and their mode-specific grants; workspace extensions distribute their reusable implementations without becoming the authority model. Extension mounts are namespaced, while additive hooks and instruction fragments are reviewed as part of the generated declaration. Root-only dispatch channels, schedules, sandboxes, and `agent.ts` configuration are never hidden inside an extension.

An agent physically lacks tools outside its entry. Combined with ADR-013 (writes only via app-runtime tools), "every boundary action passes through the Policy" becomes: the Policy knows every tool that exists, because it assigned them.

### D5 — Task kinds are first-class registry citizens

> **Amended by ADR-017, ADR-018, and ADR-019.** Task kinds describe durable root work and deterministic commitments. Agent-mode behavior remains the one-shot eve protocol below. Direct kinds now declare activation and execution policy. The bounded-retry `direct/automatic` lane is restricted to retry-safe deterministic operations: transaction-safe internal mutations or side-effect-free idempotent external reads, never external writes. Human external commitments begin in `awaiting_approval`, require an Approval Action, and make one deterministic provider call without lease reclaim.

```text
{ kind, workerKey, executionMode: agent | direct,
  activation: automatic | human,
  briefSchema (zod), outputContract (producible Object types),
  subjectKey: (payload) → string,     // the dedup key (ADR-014)
  recheckKind?: RegisteredTaskKind,   // sole scheduleRecheck target (ADR-017)
  modelOverride?, budgetClass,        // session budget sizing (ADR-011 D4)
  requires: capability[],             // see D6
  effectPhase?, effectClass?,         // trusted Policy inputs (ADR-019)
  preview?, directHandler?,           // direct/automatic only
  verificationPoll?: {                // direct/automatic, read-only only
    readHandler,                       // idempotent provider lookup
    resultSchema,                      // pending | completed | failed | unverified
    nextDueAt: (checkNumber, result, observedAt) → Date,
    deadline: (receipt, acceptedAt) → Date
  },
  commitment?: {
    providerOperation, successSemantics, receiptSchema,
    handler: (context, payload) → Promise<CommitmentOutcome<Receipt>>,
    concurrency: { kind: independent }
      | { kind: serialized,
          conflictKey: (payload) → string,
          acceptedOrdering: effect-final | provider-linearized | conditional-state },
    verification?: {
      taskKind: RegisteredTaskKind,
      receiptKey: (receipt) → string,
      firstDueAt: (receipt, acceptedAt) → Date
    },
    billing: { billable: false }
      | { billable: true, priceKey, quote: (plan) → BillingSnapshot }
  },
  schedulableBy: agent | decision | human }
```

The dispatcher validates payloads with `briefSchema` and derives subject, worker, mode, activation, and execution policy from the registered kind. A human-activation kind can be created only as `awaiting_approval`; generic enqueue cannot put it directly in `queued`. Its `commitment` block is mandatory and its preview, effect signature, connector method, handler, success semantics, stable-receipt schema, and concurrency policy come from the same entry, so a payload cannot smuggle an operation hidden from the approval UI or invent provider success. `CommitmentOutcome<Receipt>` is the closed `accepted(receipt) | rejected(code, message) | unknown(code, message)` union from ADR-019: the provider-specific handler classifies its own protocol, while the generic dispatcher only performs an exhaustive switch. `successSemantics` documents the accepted-command meaning and UI label; it is metadata, never a second HTTP/SDK classifier. Additive or otherwise proven-commutative operations declare `independent`. Stateful non-commutative operations declare `serialized` and derive one trusted `conflictKey` shared by inverse kinds on the same external target. If `succeeded` means asynchronous acceptance rather than a completed effect, registration also requires an honest ordering contract: provider linearization or a conditional/versioned state transition. Otherwise that conflicting async capability is not enabled in v1.

An accepted command needs eventual-outcome tracking only when its optional `verification` relation names one task kind owned by the same root, present in that root's `compiledSupportedKinds`, declared `direct/automatic`, and equipped with `verificationPoll`. Its handler is a side-effect-free idempotent provider read: it cannot call eve, open a model session, consume agent credit, or make an external mutation. Its `subjectKey` is Result-scoped, for example `provider-verification:<result_action_id>`, so two accepted commitments can never observe the same active poll merely because a provider lookup id collides. The receipt extractor, initial due time, typed read handler, closed result schema, bounded cadence, and deadline are trusted code. `firstDueAt` and `deadline` derive from the persisted Result Action timestamp; `nextDueAt` derives from the persisted current-poll observation timestamp. They cannot read the wall clock implicitly, so exact-key replay receives the same canonical request. A valid provider observation is `pending | completed | failed | unverified`; provider-domain `failed` says that the external job failed, not that the polling code failed. Neither the model nor the commitment payload can select a poll kind, lookup id, cadence, or deadline. A provider without durable lookup leaves `verification` absent, so product success means command acceptance only.

The billing branch is exhaustive: non-billable is explicit, while billable requires a stable `priceKey` and a trusted quote function. Approval persists the resolved `BillingSnapshot { price_key, pricing_version, currency, unit_amount }`; settlement never consults the live price table. V1 action pricing is a fixed unit amount per approved operation. Any variable external spend or blast-radius limit is a separate Policy `cost_bound`, not the Branderize `action_charge`. A kind that permits follow-ups has exactly one same-root `recheckKind`; human external commitments never use that successor mechanism.

Materialization derives a static `compiledSupportedKinds` set for every root. Its claim filters `worker_key = SELF AND kind IN compiledSupportedKinds` before any lifecycle mutation; mode plus activation then selects the one-shot agent lane, bounded-retry direct/automatic lane, or human external-commitment lane inside that responsible root. A queue row created by newer producer code but unknown to an older root build is never routed to a generic handler. Before support for a human commitment kind is removed, its unexecuted rows are terminalized as `needs_regeneration` or the old handler remains until they drain.

Once published, a kind's `briefSchema`, output contract, ownership, execution semantics, concurrency classification, conflict-key derivation, accepted-ordering contract, and verification relation/poll contract evolve only backward-compatibly. Changing a poll's receipt extractor, lookup schema, result interpretation, cadence, or deadline semantics is breaking unless the old queued payloads remain valid. A breaking contract receives a new kind, or follows an explicit expand-contract rollout: deploy consumers that accept old and new shapes, begin producing the new shape, let old rows drain, then remove legacy support. V1 stores no per-row `contract_version` and coordinates no global deployment barrier.

### D6 — Capability gating at the finest grain: task kinds and tools, never whole agents

> **Amended by ADR-017.** Durable task `requires[]` and root work-tool gating remain as written. Declared specialists receive only capability-bound read operations; missing capabilities omit those reads and surface the corresponding brand-connection requirement, while effectful connection operations are never present in the consultative manifest.

Gating a whole specialist on a missing connection is the wrong granularity (`lifecycle` does churn analysis with no connection and newsletters with Resend). Two fine grains instead:

- **Task kinds** declare provider and product `requires[]`; the dispatcher normally checks them before claim — unmet requirements leave the task queued and the console counter shows "N jobs waiting on Resend" (ADR-009). Provider Verification polls have one narrow ordering exception: exhausted-attempt retirement runs first, then the registered deadline is checked, and only then are `requires[]` evaluated. This guarantees a disconnected provider still terminates as `unverified(deadline_reached)` rather than waiting forever. Autonomous AI-credit balance is not a generic `requires[]`: it gates only agent-session claims, while a valid direct/human commitment bypasses it.
- **Capability-bound tools** are `defineDynamic` per session: a missing read or registered create-only draft capability omits it from the session surface. The console may offer a connect link, but it starts an authenticated `apps/app` onboarding flow that assigns the grant to the brand; it is not Eve's user-scoped interactive OAuth inside the agent turn. Brand connection consent remains separate from approval of a commitment task. Publish/send/activate/spend/pause/delete methods are never dynamically granted to the model.

The registry declares the universe (code); per-brand enablement is data (a projection over Decisions + connected capabilities).

### D7 — The console is also a registry consumer

`apps/app` imports the registry for the team page (roster, owns, skills), capability counters, policy-UI categories, and the plan page. Therefore `packages/agents` is isomorphic: no Node-only APIs at import time (zod schemas are fine). One source feeds the CMO's six consultative declarations, the six standalone durable wrappers plus the CMO root, all seven root dispatchers, their workspace-extension mount lists, and the console UI.

## Notes

- Redeploys change a standing human CMO conversation at its next turn. A one-shot agent task uses the root deployment that accepts it; Branderize does not pin an immutable agent version in the database. This remains consistent with the rejected `skill_snapshot` (ADR-011): code is code.
- Subagent names live in the same namespace as tool names; a collision is a build error. Naming convention: specialist slugs stay distinct from tool names.
