# Phase 0 architecture synthesis

## Decision

Use candidate C as the base. Keep `packages/brain` as the only canonical graph writer and `packages/agents` as the only owner of registry, model selection, endpoint selection, and Gateway attribution.

The first Product Marketer kind produces one task-linked `brand_context` Object. A completed run atomically supersedes the current Brand Context head. A `partial` or `blocked` run creates no Object and retains one to three questions in the normalized task completion.

No separate report Object is added in Phase 0.

## Arena result

| Candidate | Invariants | Boundary depth | Reader load | Verifiability | No extra state | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 7 | 8 | 7 | 8 | 5 | 35 |
| B | 8 | 9 | 8 | 8 | 5 | 38 |
| C | 9 | 9 | 9 | 9 | 8 | 44 |

The independent cross-judge selected C. The parent reviewed every candidate and accepted that result after checking the fixed plan and ADRs.

## Usage

The browser and CMO boundaries derive the current Better Auth Member, exact brand, Actor, and request identity. Callers then use one deep domain command.

```ts
const receipt = await brain.requestSpecialistWork({
  access: trustedCmoTurnAccess,
  intentId,
  kind: "product-marketer.brand-context.v1",
  payload: { purpose: "enrich_brand_context" },
  requestId,
});
```

The Product Marketer receives an immutable Intent snapshot and the trusted Brand Context head in its runtime brief. The model supplies only the closed report content.

```ts
const contextObject = await brain.produceProductMarketerContext({
  execution: trustedTaskExecution,
  content: validatedModelContent,
  requestId,
});

await brain.finishTask({
  execution: trustedTaskExecution,
  completion: {
    status: "completed",
    summary,
    outputObjectIds: [contextObject.objectId],
    openQuestions: [],
    intentAcceptance: null,
    result: {
      outcome: "report",
      brandContextObjectId: contextObject.objectId,
    },
  },
});
```

The payload-free dispatcher receives no brand, task, worker, schedule, or model selector.

```ts
await dispatchForRoot({
  workerKey: "product-marketer",
  now: clock.now(),
});
```

## Closed Product Marketer contract

```ts
type ProductMarketerPayload = {
  readonly purpose: "enrich_brand_context";
};

type ProductMarketerResult =
  | {
      readonly outcome: "report";
      readonly brandContextObjectId: ObjectId;
    }
  | {
      readonly outcome: "needs_input";
      readonly reason:
        | "missing_human_context"
        | "insufficient_evidence"
        | "context_unavailable";
    };
```

Registry values are fixed for Phase 0.

```text
kind = product-marketer.brand-context.v1
workerKey = product-marketer
executionMode = agent
activation = automatic
payload = { purpose: enrich_brand_context }
outputContract = { brand_context }
subjectKey = product-marketer:brand-context
schedulableBy = { agent }
acceptsPlanRouteOrigin = false
intentAcceptance = ineligible
```

Completion rules are closed.

- `completed` requires `outcome = report`, no questions, and exactly one required same-brand `brand_context` Object produced by the current task.
- `partial` and `blocked` require `outcome = needs_input`, one to three questions, no output ids, and no Object write.
- `intentAcceptance` is always null.
- Required output ids are derived from the validated result.
- A model cannot select the brand, current head, Actor, Intent snapshot, provenance, worker, model, subject key, or policy facts.

## Ownership

```text
packages/env
  runtime environment schemas

packages/db
  Better Auth tables, domain schema, migrations, pool, transactions
  no business policy

packages/policy
  pure effect and role evaluation
  no database or framework imports

packages/agents
  seven-root registry, task schemas, model resolver, endpoint resolver
  Gateway attribution, generated wrappers, skill materialization

packages/brain
  tenant-safe domain commands, canonical Action and Object writes
  Intent lifecycle, task lifecycle, conversations, schedules, projections

apps/app
  Better Auth boundary, provider adapters, CMO proxy, Cron fan-out, UI

apps/agent-cmo
apps/agent-product-marketer
  functional Eve roots

apps/agent-content
apps/agent-distribution
apps/agent-seo-discovery
apps/agent-lifecycle
apps/agent-growth
  health-only Phase 0 roots
```

Test helpers stay colocated with their owning package. There is no production-facing test-support package.

## Transaction boundaries

1. Brand onboarding creates the brand, Human Actor, disabled schedule mirrors, active revision-1 Intent, and declaration Action in one transaction.
2. Context.dev reads, binary downloads, validation, hashing, and Blob uploads occur outside PostgreSQL.
3. Context bootstrap commits the system Action, Artifact Objects, and initial Brand Context in one receipt-first transaction.
4. Intent declaration and refinement resolve exact replay before mutable guards and then update the Intent plus Action atomically.
5. Specialist request resolves replay first, locks the active Intent, builds the immutable snapshot, evaluates Policy, applies credit admission, and inserts the task atomically.
6. Task claim and Eve session binding use short transactions without provider I/O.
7. Product Marketer output compares the trusted expected Brand Context head, writes one Action, supersedes the old head, and creates the new `brand_context` Object atomically.
8. `finishTask` fill-or-match stages normalized completion while the task is running.
9. The authoritative top-level Eve terminal event settles the task. Child sessions cannot settle it.
10. Session events deduplicate on Eve `meta.id`. Only winning billable `step.completed` events create ledger charges.
11. Question resolution appends a separate receipt and never resumes or reruns the old task.

Successful tool-level graph writes remain canonical even if later Eve settlement fails.

## Runtime flow

```text
browser or CMO boundary
  -> current Member and exact brand access
  -> one brain command
  -> PostgreSQL transaction
  -> canonical row

payload-free dispatch
  -> claim one supported Product Marketer task
  -> load immutable Intent snapshot
  -> load trusted Brand Context head
  -> one Eve task session
  -> produce Product Marketer context from content only
  -> atomically supersede one Brand Context head
  -> stage normalized completion
  -> settle from the authoritative terminal event
```

## Grafts

Candidate B contributed the deep domain-specific Product Marketer write boundary, the strict completed-versus-questions union, same-brand source validation, stale-head rejection, and atomic supersession.

Candidate A contributed the four-journey verification map, Eve parity and reducer checks, root health checks, scripted-provider exclusion, compaction billing checks, Gateway attribution checks, versioned URL normalization, stable Context bootstrap keys, and PostgreSQL race assertions.

The separate report Object, model-visible baseline Context id, partial report write, and `no-change` completion were rejected.

## Verification sequence

1. Add root scripts, Vitest, Playwright, PostgreSQL 17 Compose, and Eve protocol probes.
2. Add environment, database, migrations, Better Auth ownership, and domain parsers.
3. Add pure Policy and replay-safe brain commands.
4. Add Context.dev and Blob adapters with a scripted local boundary.
5. Add registry, exact model selection, endpoint resolution, and seven roots.
6. Add private CMO conversation and proxy boundaries.
7. Add the one-shot Product Marketer task and settlement.
8. Add the four browser journeys with canonical PostgreSQL assertions.
9. Close the local and CI predicate.
10. Record hosted canary evidence separately.

## Accepted tradeoffs

- One larger brain package replaces several shallow service and repository layers.
- PostgreSQL is the only shared coordination point.
- Five roots are health-only in Phase 0 so the seven-root deployment contract exists without false capability.
- Agent tasks have no automatic retry after an authoritative Eve session is bound.
- Hosted Google, Context.dev, Blob, Neon, AI Gateway, Cron, and telemetry remain a separate canary predicate.

## Principles and changed choices

- Subtract Before You Add removed the second report Object and a production test-support package.
- Boundary Discipline kept model, provider, Better Auth, Blob, Eve, and Drizzle representations out of domain signatures.
- Model the Domain selected a closed Product Marketer kind and discriminated completion instead of a generic task result.
- Type System Discipline selected branded ids, immutable origin branches, and strict boundary parsing.
- Make Operations Idempotent selected Action receipts, stable Blob keys, fill-or-match completion, and one authoritative task session.
- Minimize Reader Load selected a short boundary to brain to transaction path.
- Prove It Works made the four browser-to-PostgreSQL journeys the local product predicate.
- Build the Lever made migration fixtures, protocol probes, controlled clocks, and scripted providers reusable verification artifacts.
- Sequence Work into Verifiable Units ordered implementation by real checks rather than package count.

## Agreement

The user explicitly requested implementation. The human architecture checkpoint is skipped and this synthesis is the implementation contract.
