# ADR-003: Web console as the primary surface, eve mounted in apps/app

- **Status:** amended
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), with assisted analysis
- **Amended by:** [ADR-009](009-agent-deployment-and-console-data-surface.md) — the console primacy and the four surfaces stand; the deployment topology is reversed: seven standalone eve roots sit outside `apps/app`, whose same-origin proxy reaches only the CMO
- **Amended by:** [ADR-019](019-human-approved-external-commitments.md) — the approval inbox is a projection over human-activation tasks in `awaiting_approval`, not pending Actions

## Context

The candidate primary channels:

- **The eve dev TUI** — zero-friction for development (the template's default), but not a product surface.
- **Slack** — the template's production channel via Vercel Connect; excellent for teams already living in Slack, but it makes a human-native tool the place where work state appears, in tension with the ADE grammar (communication is a view, never the canonical state).
- **A web console** — required anyway by ADR-001 (self-serve SaaS needs a web surface), and the only surface we fully control.

The ADE document is explicit on two points that bear directly on this choice: natural language is an *interface*, not the substrate (§13), and the anti-metric is *liberated attention* — human time in the environment must trend down at constant output (§16).

A second, related decision: whether the eve agent runs as its own deployment (the [CRM](https://github.com/trycompai/crm) pattern: `apps/agent` ships separately) or mounted inside the Next.js console via `withEve()` (the [eve](https://eve.dev) documented integration: same dev server, same deploy, `useEveAgent()` auto-discovers same-origin routes).

## Decision

> **Superseded topology.** The console decision below still stands, but the in-process eve mount and its consequences are historical. ADR-009 now defines `agent-cmo` plus six standalone specialist root deployments; `apps/app` proxies user traffic only to the CMO.

**The web console is the primary surface, and eve is mounted inside `apps/app` via `withEve()`.**

The console is a projection over the graph, with four surfaces in priority order:

1. **Approval inbox** — human-activation direct tasks in `awaiting_approval`; the Approval Action is appended only when the human clicks
2. **Digest with citations** — narrative rendering of what happened on your intents, every claim linked to the canonical objects backing it
3. **Graph browser** — backward traversal from any object to its justifying Intents and Decisions
4. **Chat** — natural-language intent entry only (transduction); never a place of truth

Two carved-in-stone rules:

- **No intelligence in the console routes.** Routes read projections and write only intents, approvals, and explicit pre-claim cancellations through `packages/brain`. An app route that calls an enrichment API or makes a judgment is treated as a bug (the CRM's rule).
- **The console optimizes for liberated attention, not engagement.** A console that maximizes time-in-app is failing.

## Consequences

- **One deployment instead of three** (contrast with the CRM's app/api/agent split): same origin, no CORS, the logged-in user's principal resolved by the same auth for both console and agent.
- **Slack becomes a later, optional channel** — an eve channel file added when a phase needs it, rendering the same graph into messages. It is never the canonical state.
- **The TUI remains the development surface** (`pnpm dev`), but no product behavior depends on it.
- **Exit path is documented, not taken**: when a specialist needs its own credentials and release cycle — `growth` with ad-platform access is the first candidate, Phase 4 — it becomes a **remote agent** in its own deployment (`defineRemoteAgent`), while the lead stays mounted in `apps/app`. If operational pressure ever demands it, the whole agent can be split into `apps/agent`; the boundary is already clean because all state flows through `packages/brain`.
- **Risk accepted**: building the console before the agent team is deep could produce a shell. Mitigated by scoping console v0 to intent entry + object browser + approval inbox — exactly what Phases 0–1 need, nothing more.

## Alternatives considered

- **Slack-first** — rejected as primary: it outsources our main surface to a human-native feed and blurs the view/truth boundary the grammar depends on. Retained as a future secondary channel.
- **Separate `apps/agent` deployment from day one** — rejected for now: three deployments of operational overhead before the product justifies it; the split point is preserved by design.
