# ADR-001: Multi-tenant SaaS product

- **Status:** active
- **Date:** 2026-08-05
- **Deciders:** Tommaso (human), with assisted analysis
- **Amended by:** [ADR-019](019-human-approved-external-commitments.md) — real tenant foreign keys cascade every internal brand-scoped row on brand deletion; provider resources may remain orphaned

## Context

Two possible directions for branderize-cmo:

- **Single-tenant internal tool**, following the [trycompai/crm](https://github.com/trycompai/crm) pattern: one installation, one allow-list as the entire authorization model, "there are no organizations". This is also the experimental regime the ADE document (§15) describes: a single confidentiality domain.
- **Multi-tenant SaaS product**, following the [Magister](https://magistermarketing.com/) benchmark: organizations with many brands, seats, credit-based billing, self-serve onboarding.

The choice determines the shape of auth, data isolation, the persistence substrate, and the business model.

## Decision

branderize-cmo is a **multi-tenant SaaS product**:

- `organizations → brands` and `organizations → Better Auth members`: each brand has one non-null `organization_id`, and every work-graph row is still scoped by mandatory `brand_id`
- V1 tenant visibility is **organization-wide**. Every Better Auth `Member(organization_id, user_id)` may read the ordinary product projections of every brand whose `brands.organization_id` matches that membership; its current role (`owner`, `admin`, `member`, or application-level read-only `viewer`) is then enforced per operation across all those brands. Membership is not blanket mutation or CMO-turn authority. There is no Better Auth Team and no `brand_memberships` table.
- Human identity is global, authorization is organizational: one Better Auth User maps to one human `Actor` across every organization, while each exact Member row independently supplies that user's current role in one organization. Actors have no `organization_id` or `brand_id`.
- V1 does not expose Better Auth hard account deletion. Offboarding removes the relevant organization Memberships and revokes sessions; it does not delete the global User or Actor, and therefore does not erase historical attribution. A future self-service erasure/tombstone protocol is a separate decision rather than an implicit cascade.
- Every authenticated brand boundary resolves the requested `brand_id`, obtains its `organization_id`, and validates the exact Better Auth `Member(organization_id, user_id)` plus the current role required by that operation. Membership establishes tenant eligibility; it never replaces the role check or `brand_id` in domain queries, uniqueness constraints, provenance, billing, or deletion scoping. Application and CMO-proxy boundaries reread that Member on every request; a role captured in a prior bridge JWT, session, browser state, or conversation row is never authority for the next request.
- Creating a CMO conversation, starting its first turn, sending a follow-up, answering HITL, saving its cursor, and invoking any product mutation require the exact conversation owner with current Member role `owner | admin | member`. `viewer` cannot exercise those operations, compact, clear, or reset the Eve session. The only state-reducing exception is that the exact current conversation owner who remains a Member after being downgraded to `viewer` may stop a turn they already observed by sending its exact `turnId` to the cancel endpoint; this does not authorize a later follow-up or any other mutation. Conversation listing, metadata, transcript, snapshot, and stream reads require that same exact owner for every role; another organization Member has no read override in v1.
- Self-serve onboarding starts without inference: the authenticated product boundary creates the brand, its human-authored `active` revision-1 onboarding Intent, and `website_url`; a server-side `apps/app` onboarding action then calls context.dev directly, validates and normalizes the response, and produces Brand Context v0 through the canonical Action/Object path. It is application onboarding logic, not a task, Eve session, or specialist-root execution. Only the later CMO-guided refinement enters the agent lane.
- Credit-based billing: monthly pool per plan, metered consumption, paid overage
- Real authentication through Better Auth passwordless email OTP, rendered
  with React Email and delivered by Resend, instead of a bare allow-list. The
  local supervisor uses a server-guarded no-delivery OTP mode.

Dogfooding remains the wedge: the first tenant is branderize itself, and `apps/web` is the public site the agent team markets.

## Consequences

- **Auth is real work from day one.** Sessions, one organization membership per user/org pair, organization-wide roles, and one stable audit Actor per global User. The CRM's "one env var is the whole authorization model" is not available to us.
- **Tenant isolation and deletion are schema concerns.** Every internal brand-scoped row has a real foreign-key path to `brands` with cascading delete, while `packages/brain` remains the scoped read/write boundary. External provider resources are not part of that database graph.
- **Viewer means read-only authorization, not a different tenancy relation.** A viewer is still a Better Auth Member and may read ordinary brand-scoped product projections. Conversation metadata, transcript, snapshot, and stream are a narrower owner-only surface in v1: the current user must also equal `cmo_conversations.owner_user_id`. A viewer who owns the conversation may read it but cannot start or continue CMO work, answer HITL, checkpoint the cursor, perform product mutations, or approve. ADR-016's exact-owner, exact-`turnId` stop exception only removes authority from an already observed in-flight turn; it grants no write surface. Canonical Intents, Decisions, Objects, Actions, and tasks produced from a conversation remain ordinary organization-visible brand projections; transcript ownership does not make those graph facts private.
- **User offboarding and tenant deletion are different operations.** Removing a Member immediately removes that organization's access and revoking sessions ends active authentication, while the global User/Actor remains. Deleting a brand still cascades its own graph and audit rows under ADR-019; it does not delete a User who may belong to another organization.
- **The single-confidentiality-domain regime of the ADE document is exited on day zero.** Per-object (per-tenant) confidentiality is a requirement from the start, which pulls the migration trigger named in §15 of the document. This directly motivates ADR-002.
- **The "single owner of shared state" rule becomes per-brand.** The product-marketer is the responsible steward for refinement of each brand's context, not necessarily the producer of every version: deterministic `system:context-dev` produces v0, while later specialist work may supersede it.
- **A credit ledger is required**, and it is append-only during the brand's lifetime like the Action log; brand deletion cascades its brand-scoped rows (see ADR-002, ADR-019).
- Context.dev bootstrap does not consume AI credit because it makes no model call. The independent product decision of how much autonomous AI credit a new brand receives is not fixed by this onboarding mechanism.

## Alternatives considered

- **Single-tenant first, multi-tenant later** — rejected: retrofitting tenancy into a schema and an agent permission model is far more expensive than designing it in, and the product benchmark (Magister) shows the market shape.
- **Single-tenant forever** — rejected: it contradicts the product ambition; it remains the right pattern only for a purely internal tool.
