# ADR-001: Multi-tenant SaaS product

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), with assisted analysis

## Context

Two possible directions for branderize-cmo:

- **Single-tenant internal tool**, following the [trycompai/crm](https://github.com/trycompai/crm) pattern: one installation, one allow-list as the entire authorization model, "there are no organizations". This is also the experimental regime the ADE document (§15) describes: a single confidentiality domain.
- **Multi-tenant SaaS product**, following the [Magister](https://magistermarketing.com/) benchmark: organizations with many brands, seats, credit-based billing, self-serve onboarding.

The choice determines the shape of auth, data isolation, the persistence substrate, and the business model.

## Decision

branderize-cmo is a **multi-tenant SaaS product**:

- `organizations → brands → users`: each organization operates one or more brands; every row of the work graph is scoped by `brand_id`
- Self-serve onboarding: signup → brand creation with `website_url` → the agent's onboarding loop builds the brand brain
- Credit-based billing: monthly pool per plan, metered consumption, paid overage
- Real authentication (Better Auth, Google sign-in) instead of a bare allow-list

Dogfooding remains the wedge: the first tenant is branderize itself, and `apps/web` is the public site the agent team markets.

## Consequences

- **Auth is real work from day one.** Sessions, org membership, roles. The CRM's "one env var is the whole authorization model" is not available to us.
- **Tenant isolation is a schema concern.** `brand_id` on every grammar-layer table, enforced in `packages/brain` — the single write path is also the single tenancy boundary.
- **The single-confidentiality-domain regime of the ADE document is exited on day zero.** Per-object (per-tenant) confidentiality is a requirement from the start, which pulls the migration trigger named in §15 of the document. This directly motivates ADR-002.
- **The "single owner of shared state" rule becomes per-brand.** The product-marketer owns the brand context *of each brand*, not of the installation.
- **A credit ledger is required**, and it is append-only like everything else (see ADR-002).

## Alternatives considered

- **Single-tenant first, multi-tenant later** — rejected: retrofitting tenancy into a schema and an agent permission model is far more expensive than designing it in, and the product benchmark (Magister) shows the market shape.
- **Single-tenant forever** — rejected: it contradicts the product ambition; it remains the right pattern only for a purely internal tool.
