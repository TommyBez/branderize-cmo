# ADR-004: Extended roster of six specialists, modeled on marketingskills

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), with assisted analysis
- **Amended by:** [ADR-006](006-dual-declaration.md) — specialists are dual-materialized (consultative subagent + standalone durable root) from a shared registry, not single directories under `agent/subagents/`
- **Amended by:** [ADR-009](009-agent-deployment-and-console-data-surface.md) — the CMO and all six specialist durable roots are standalone eve apps/deployments from the beginning
- **Amended by:** [ADR-010](010-plan-as-derivation.md) — the CMO generates structured Marketing Plans from an exact Strategy, may record the Evidence and Move Candidates needed by that synthesis, and leaves validation, provenance and supersession to the application
- **Amended by:** [ADR-020](020-typed-decisions-and-impact-verification.md) — active v1 Decisions are recorded by humans; Growth owns agentic impact measurement and the CMO owns reconsideration recommendations

## Context

Two references pull in different directions:

- The [marketing-team-eve-template](https://github.com/vercel-labs/marketing-team-eve-template) ships **five** specialists with deliberately non-overlapping jobs, and its architecture doc warns that the boundaries exist so guidance doesn't drift or duplicate.
- [marketingskills](https://github.com/coreyhaines31/marketingskills) provides **~44 skills in nine categories**, with `product-marketing` as the foundation every other skill reads first.

A key structural insight reconciles them: 44 skills ≠ 44 agents. Skills are load-on-demand playbooks; agents are actors with scope and accountability. The question is how to cluster the skills into actors with distinct, non-overlapping jobs — and whether the lead itself should carry skills.

## Decision

**Six specialists plus the lead, with the lead acting as the CMO and holding the strategy skills.**

| Agent | Owns | Skills |
| --- | --- | --- |
| **cmo** (lead) | Routing, strategy, synthesis | marketing-plan, pricing, offers, marketing-ideas, marketing-council, marketing-loops |
| `product-marketer` | The brand brain: positioning, messaging, competitive set | product-marketing, customer-research, competitor-profiling, marketing-psychology |
| `content` | Long-form prose | copywriting, copy-editing, content-strategy, image, video |
| `distribution` | Short-form social, launches, PR, partnerships | social, launch, public-relations, co-marketing, directory-submissions, influencer-marketing |
| `seo-discovery` | Which pages should exist, audits, schema | seo-audit, ai-seo, site-architecture, programmatic-seo, schema, competitors |
| `lifecycle` | Email, onboarding, activation, retention | emails, onboarding, signup, churn-prevention, popups, paywalls, sms |
| `growth` | Paid, experiments, measurement | ads, ad-creative, ab-testing, analytics, attribution |

Design rules carried over from the template and extended:

- **No hidden cross-specialist nesting**: the lead consults locally or requests durable root work; durable roots may use eve self-copies within their current task and request separate specialist work only through typed lateral tasks (ADR-013, ADR-017).
- **Non-overlap by job, not by artifact**: the product-marketer decides what the team claims; content writes words; seo-discovery decides which pages exist; distribution and lifecycle are the two that reach an audience. For cross-channel work such as a newsletter, the lead routes the initial hop; after producing the Artifact, that durable specialist root requests the registered lateral hop with the Artifact id.
- **The brand context has a single responsible steward per brand** (the product-marketer) and is read by every specialist at the start of every task. Stewardship means responsibility for agentic refinement and quality, not false authorship of deterministic v0 produced by `system:context-dev` — the marketingskills `product-marketing` foundation pattern, enforced by tooling rather than convention.
- **Skills are vendored, not copied by hand**: `packages/marketing-skills` is a git submodule of the upstream repo. A workspace eve extension packages the selected, rewritten skills and other reusable contributions; generated root and subagent wrappers mount the appropriate namespaced extension rather than carrying hand-maintained copies. The extension build rewrites context-file references (`.agents/product-marketing.md` → the `get_brand_context` tool backed by the brain). Cross-cutting skills (writing-quality, banned words) use the `defineSkill` factory pattern. Agent config, sandboxes, schedules, and custom channels remain local because eve extensions cannot provide them.

## Consequences

- **A build step exists**: skill materialization runs before `eve build`/`eve dev`, and `npx eve info` is the discovery diagnostic that verifies the resulting surface.
- **Connections arrive in phases**, not with the roster: Notion/Typefully in Phase 1, Resend in Phase 3, analytics in Phase 3, ad platforms in Phase 4. A specialist without its connections still works — it recommends instead of operating, and says so (the CRM's "plan around what you actually have" rule).
- **Every durable root is standalone from the beginning**: `growth` is not a special Phase-4 graduation. The CMO and all six specialists each have their own eve application and Vercel deployment; the six specialist definitions are also materialized locally as consultative CMO subagents from the shared registry.
- **The roster is data, not dogma**: adding a specialist means adding one registry entry plus its generated standalone root app; hand-maintained copies of its consultative and durable definitions are forbidden. This ADR is superseded the day empirical routing failures show a boundary is wrong.

## Alternatives considered

- **The template's five as-is** — rejected: it leaves paid/measurement and lifecycle/retention uncovered, two areas where marketingskills and the Magister benchmark both show real demand.
- **Start with three and grow empirically** — rejected as the *plan* but retained as the *build order*: the roster is fully designed now (so boundaries are coherent) while implementation lands in phases (product-marketer first in Phase 0; content, distribution, seo-discovery in Phase 1; lifecycle and growth later).
