# ADR-003: Web console as the primary product surface

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

## Decision

**The web console is the primary product surface.** Deployment topology, CMO proxying, and agent ingress are owned by [ADR-009](009-agent-deployment-and-console-data-surface.md); this ADR makes no current topology claim.

The console is a projection over the graph, with four surfaces in priority order:

1. **Approval inbox** — human-activation direct tasks in `awaiting_approval`; the Approval Action is appended only when the human clicks
2. **Digest with citations** — narrative rendering of what happened on your intents, every claim linked to the canonical objects backing it
3. **Graph browser** — backward traversal from any object to its justifying Intents and Decisions
4. **Chat** — natural-language intent entry only (transduction); never a place of truth

Two carved-in-stone rules:

- **No agent intelligence in the console routes.** Routes never run an LLM, import agent runtime code, or make model-authored judgments. They normally read projections and write intents, approvals, and explicit pre-claim cancellations through `packages/brain`. The one onboarding adapter is deliberately deterministic application logic: a server-side `apps/app` action calls context.dev, validates and normalizes its response, then writes Brand Context v0 through the same canonical brain boundary. The browser never receives the provider credential.
- **The console optimizes for liberated attention, not engagement.** A console that maximizes time-in-app is failing.

## Consequences

- **Slack remains an optional secondary view** over the same graph. It is never canonical state.
- **The TUI remains a development surface** (`pnpm dev`), but no product behavior depends on it.
- **Console v0 stays narrow**: Intent entry, Object browser, and the task-based approval inbox. Agent deployment and authentication consequences are specified only by ADR-009 and ADR-016.

## Alternatives considered

- **Slack-first** — rejected as primary: it outsources our main surface to a human-native feed and blurs the view/truth boundary the grammar depends on. Retained as a future secondary channel.
- **A channel-first product** — rejected: no chat or feed becomes the state store.
