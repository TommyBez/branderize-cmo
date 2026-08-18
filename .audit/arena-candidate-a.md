# Candidate architecture package

## Usage first

The consumer-facing contract is a small set of domain operations. Framework routes, Eve, Drizzle, and provider payloads stay behind those boundaries.

`ts
const onboarding = await appServer.createBrand({
  brandId,
  websiteUrl: "https://example.com",
  initialIntent: {
    statement: "Understand our positioning and improve our marketing.",
  },
  requestId,
  tenant: currentTenant,
});

const declared = await brain.declareIntent({
  brandId,
  statement: "Clarify our ideal customer and message.",
  parentIntentId: null,
  requestId,
  actor: humanMutationContext,
});

const task = await brain.requestSpecialistWork({
  brandId,
  requestId,
  kind: "product-marketer.enrich-brand-context",
  intentId: declared.intentId,
  payload: {
    baselineContextObjectId: onboarding.contextObjectId,
  },
  requester: interactiveCmoContext,
});
`

The CMO wrapper exposes only a semantic selector. Trusted code supplies the tenant, owner, conversation, turn, task origin, and current Intent snapshot.

`ts
const result = await cmoTools.request_specialist_work({
  intent_id: candidateIntentId,
  kind: "product-marketer.enrich-brand-context",
  payload: {
    baselineContextObjectId: currentContextObjectId,
  },
});
`

The model cannot supply \`brandId\`, \`workerKey\`, \`subjectKey\`, \`intentSnapshot\`, \`Actor\`, \`Member\`, \`Policy\`, or task provenance.

The Product Marketer root receives work only through the payload-free dispatcher.

`ts
await rootDispatcher.dispatch({
  self: "product-marketer",
  now: controlledClock.now(),
});
`

The route receives only the authenticated dispatch secret. It does not accept a task, brand, worker, schedule, or payload selector.

## Type sketch

`ts
type BrandId = string & { readonly __brand: "BrandId" };
type OrganizationId = string & { readonly __brand: "OrganizationId" };
type UserId = string & { readonly __brand: "UserId" };
type ActorId = string & { readonly __brand: "ActorId" };
type IntentId = string & { readonly __brand: "IntentId" };
type ObjectId = string & { readonly __brand: "ObjectId" };
type ActionId = string & { readonly __brand: "ActionId" };
type TaskId = string & { readonly __brand: "TaskId" };
type ConversationId = string & { readonly __brand: "ConversationId" };
type EveSessionId = string & { readonly __brand: "EveSessionId" };

type MemberRole = "owner" | "admin" | "member" | "viewer";

type TenantAccess = {
  readonly brandId: BrandId;
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly role: MemberRole;
};

type HumanMutationContext = TenantAccess & {
  readonly actorId: ActorId;
  readonly operationSource: "human";
};

type InteractiveCmoContext = TenantAccess & {
  readonly actorId: ActorId;
  readonly conversationId: ConversationId;
  readonly sessionId: EveSessionId;
  readonly turnId: string;
  readonly operationSource: "interactive-cmo";
};

type IntentSnapshot = {
  readonly intentId: IntentId;
  readonly revision: number;
  readonly statement: string;
  readonly acceptanceCriteria: readonly string[] | null;
  readonly constraints: readonly string[] | null;
  readonly preauthorizingDecisions: readonly {
    readonly decisionId: ObjectId;
    readonly authorizedIntentRevision: number;
    readonly policyFacts: Readonly<Record<string, unknown>>;
  }[];
};

type TaskOrigin =
  | {
      readonly kind: "intent";
      readonly snapshot: IntentSnapshot;
    }
  | {
      readonly kind: "plan-route";
      readonly planObjectId: ObjectId;
      readonly moveCandidateId: ObjectId;
    }
  | {
      readonly kind: "none";
    };

type TaskExecution = {
  readonly executionMode: "agent" | "direct";
  readonly activation: "automatic" | "human";
};

type OpenQuestion = {
  readonly questionId: string;
  readonly prompt: string;
  readonly answerKind: "text" | "choice";
  readonly required: boolean;
};

type TaskCompletion<Result> = {
  readonly status: "completed" | "partial" | "blocked";
  readonly summary: string;
  readonly outputObjectIds: readonly ObjectId[];
  readonly openQuestions: readonly OpenQuestion[];
  readonly intentAcceptance: null;
  readonly result: Result;
};

type ProductMarketerPayload = {
  readonly baselineContextObjectId: ObjectId;
};

type ProductMarketerResult = {
  readonly outcome: "reported";
  readonly reportObjectId: ObjectId;
  readonly brandContextObjectId: ObjectId;
};

type ProductMarketerCompletion =
  TaskCompletion<ProductMarketerResult>;

type ProductMarketerCompletionResult =
  | ProductMarketerResult
  | {
      readonly outcome: "no-change";
      readonly reason: "already-current";
    };
`

The parser enforces the cross-field rules that types alone cannot express.

- \`completed\` has no open questions.
- \`partial\` and \`blocked\` require one to three questions.
- Questions have unique identifiers and bounded prompt length.
- Phase 0 Product Marketer completion always has \`intentAcceptance: null\`.
- \`reported\` requires both Object ids.
- \`no-change\` has no required output Object.
- Required output ids are derived from the validated result, not trusted from model selection.

## Public function signatures

`ts
type DeclareIntentInput = {
  readonly brandId: BrandId;
  readonly statement: string;
  readonly parentIntentId: IntentId | null;
  readonly requestId: string;
  readonly actor: HumanMutationContext | InteractiveCmoContext;
};

type DeclareIntentResult = {
  readonly intentId: IntentId;
  readonly revision: number;
  readonly actionId: ActionId;
  readonly replayed: boolean;
};

declare function declareIntent(
  input: DeclareIntentInput,
): Promise<DeclareIntentResult>;

type RefineIntentInput = {
  readonly brandId: BrandId;
  readonly intentId: IntentId;
  readonly expectedRevision: number;
  readonly criteria: readonly string[];
  readonly constraints: readonly string[];
  readonly requestId: string;
  readonly actor: HumanMutationContext | InteractiveCmoContext;
};

declare function refineIntent(
  input: RefineIntentInput,
): Promise<{
  readonly intentId: IntentId;
  readonly revision: number;
  readonly actionId: ActionId;
  readonly replayed: boolean;
}>;

type RequestSpecialistWorkInput = {
  readonly brandId: BrandId;
  readonly intentId: IntentId;
  readonly kind: "product-marketer.enrich-brand-context";
  readonly payload: ProductMarketerPayload;
  readonly requestId: string;
  readonly requester: InteractiveCmoContext;
};

declare function requestSpecialistWork(
  input: RequestSpecialistWorkInput,
): Promise<{
  readonly taskId: TaskId;
  readonly status: "queued" | "running" | "succeeded" | "failed";
  readonly origin: TaskOrigin;
  readonly replayed: boolean;
}>;

type FinishTaskInput = {
  readonly taskId: TaskId;
  readonly completion: ProductMarketerCompletion;
  readonly session: {
    readonly sessionId: EveSessionId;
    readonly parentSessionId: EveSessionId | null;
  };
};

declare function finishTask(
  input: FinishTaskInput,
): Promise<ProductMarketerCompletion>;

declare function createBrandWithOnboardingIntent(input: {
  readonly brandId: BrandId;
  readonly websiteUrl: string;
  readonly initialIntentStatement: string;
  readonly requestId: string;
  readonly tenant: HumanMutationContext;
}): Promise<{
  readonly brandId: BrandId;
  readonly intentId: IntentId;
  readonly intentRevision: number;
  readonly contextStatus: "pending";
}>;

declare function commitContextBootstrap(input: {
  readonly brandId: BrandId;
  readonly normalizedWebsite: {
    readonly value: string;
    readonly label: "website-normalization-v1";
  };
  readonly requestId: string;
  readonly artifacts: readonly {
    readonly blobKey: string;
    readonly sha256: string;
    readonly mediaType: string;
    readonly bytes: number;
  }[];
  readonly context: Readonly<Record<string, unknown>>;
}): Promise<{
  readonly contextObjectId: ObjectId;
  readonly artifactObjectIds: readonly ObjectId[];
  readonly actionId: ActionId;
  readonly replayed: boolean;
}>;
`

The public surface intentionally has no generic \`insertAction\`, \`insertObject\`, \`saveTask\`, repository, or transaction callback. Each operation owns the policy, provenance, replay, and transaction rules it needs.

## Package and module map

`text
packages/env
  server environment schemas
  deployment-specific validation
  no shared implicit .env

packages/db
  Better Auth and domain Drizzle schema
  PostgreSQL client and bounded pool
  migration runner
  transaction adapter
  SQL views and indexes
  no business policy

packages/policy
  closed effect signatures
  pure role and structure evaluator
  typed policy verdict and snapshot
  no database or framework imports

packages/agents
  shared registry
  Product Marketer and CMO declarations
  seven-root manifest
  task-kind schemas and output contracts
  model profile catalog
  model resolver and Gateway attribution factory
  skill materialization and build manifest

packages/brain
  brand and onboarding state
  Intent lifecycle
  canonical Object and Action writes
  task creation, claim, completion, settlement
  CMO conversation ownership and projections
  tenant-safe graph reads
  schedule reconciliation and calendar helper
  credit and session-event persistence
  all canonical writes pass through here

apps/app
  Better Auth boundary
  current Member and brand authorization
  Server Actions and Route Handlers
  Context.dev adapter
  private Blob upload and delivery boundary
  CMO proxy and session ownership checks
  payload-free Cron fan-out
  browser projections and UI

apps/agent-cmo
  generated Eve CMO root
  consultative Product Marketer declaration
  interactive tools
  model-config factory
  health endpoint
  no direct database writes

apps/agent-product-marketer
  generated durable Product Marketer root
  task-mode channel
  root-only finishTask
  model-config factory
  health endpoint

apps/agent-content
apps/agent-distribution
apps/agent-seo-discovery
apps/agent-lifecycle
apps/agent-growth
  generated health-only Phase 0 roots
  shared registry and audit/model contracts
  no active task kinds

packages/test-support
  PostgreSQL fixture lifecycle
  controlled clock
  scripted Context.dev adapter
  scripted inference provider
  server-only test fixtures
  production-provider exclusion assertions

apps/app/e2e
  Playwright browser journeys
  Axe checks
  canonical-row assertions

.github/workflows
  full root gate
  PostgreSQL 17 service
  Eve version parity
  migration and build artifacts
`

Modules are grouped by domain ownership. They are not split into \`load\`, \`validate\`, \`transform\`, and \`save\` stages.

## Transaction boundaries

1. Better Auth creates the user, organization, Member, session, and account. The application then runs one brain transaction for the brand, human-authored active revision-1 Intent, disabled schedule mirrors, and required initial Actor materialization. A failed graph transaction does not claim that onboarding completed.

2. Context.dev and Blob operations run outside any database transaction. The adapter parses and normalizes Context.dev data. Binary bytes are validated, hashed, and uploaded idempotently before any canonical Object references exist.

3. \`commitContextBootstrap\` runs one brain transaction. It resolves the normalized website operation receipt from \`actions.operation_key\` and \`request_hash\`, locks the Brand Context head, creates Artifact Objects, creates the Brand Context Object, appends the producing \`system:context-dev\` Action, and commits the new head atomically.

4. \`declareIntent\` and \`refineIntent\` perform receipt lookup before mutable-state guards. On a miss, they lock the same-brand Intent row, apply the revision guard, append the Action, and update the Intent in one transaction.

5. \`requestSpecialistWork\` performs receipt lookup before active-Intent and Policy checks. On insertion it locks the active Intent, snapshots its current revision and applicable preauthorizations, validates the registry kind and payload, evaluates Policy, and inserts the task with the Action receipt in one transaction.

6. The dispatcher claim is a short PostgreSQL transaction. It changes one supported \`queued\` task to \`running\`, records \`started_at\`, and commits before Eve I/O. Zero-credit agent tasks remain queued. No provider or model call runs inside this transaction.

7. Eve delivery runs outside the transaction. The top-level \`session.started\` hook and post-send path fill the single authoritative \`session_id\`. Only an unbound five-minute handoff may return to \`queued\`.

8. \`finishTask\` runs one transaction. It rejects child sessions structurally, reloads the trusted task, validates and normalizes the completion, derives required output ids, and fill-or-match stages the completion while the task is still \`running\`.

9. Authoritative Eve terminal settlement runs another transaction. \`session.completed\` with a valid staged completion changes \`running\` to \`succeeded\`. Missing completion and technical session failures become \`failed\`. \`partial\` and \`blocked\` remain successful domain outcomes.

10. A successful Product Marketer report uses one brain transaction to append the task-bound Action, create the report Object, supersede the Brand Context head, create the new Brand Context Object, and stage the completion. The enclosing task may later fail without rolling back already committed graph facts.

11. Session events are inserted idempotently by \`meta_id\`. Billable \`step.completed\` events create at most one ledger charge. Compaction events never create charges.

12. Task-question resolution is a separate top-level CMO transaction. It reloads the exact source task and immutable question bundle, requires a current non-viewer Member, appends one \`task_questions_resolved\` Action, and changes only the projection. It never resumes or reruns the task.

## Data flow

The four Phase 0 journeys use this shape.

`text
Better Auth session
  -> apps/app loads brand -> organization -> current Member
  -> typed brain boundary with exact brandId
  -> PostgreSQL Action/Object/Intent/task state
  -> ordinary SQL projection
  -> browser
`

Canonical onboarding:

`text
sign in
  -> organization + brand + active Intent rev.1
  -> Context.dev request outside DB transaction
  -> normalized response and validated binary variants
  -> content-addressed private Blob uploads
  -> brain transaction
  -> system:context-dev Action
  -> Artifact Objects + Brand Context v0
  -> authenticated preview/download by exact brand path
`

CMO declaration and refinement:

`text
owner opens own conversation
  -> app proxy checks exact owner and current Member
  -> CMO turn
  -> read-only Product Marketer consultation
  -> explicit human request
  -> trusted request_specialist_work selector
  -> brain snapshots active Intent and inserts one task
  -> Product Marketer one-shot Eve session
  -> report and Brand Context supersession, or partial/blocked completion
  -> task detail shows immutable questions
  -> later user-owned CMO turn can refine Intent or explicitly request new work
  -> resolve_task_questions closes the card only after the whole bundle is addressed
`

Privacy and tenancy:

`text
same-organization Member
  -> ordinary brand graph projections allowed
  -> another user's CMO conversation denied

viewer who owns conversation
  -> transcript read allowed
  -> exact observed-turn cancel allowed
  -> send, follow-up, cursor, and product mutations denied

different organization
  -> brand lookup and every graph operation fail closed
`

Model and endpoint resolution:

`text
brand-addressed proxy
  -> resolve brand -> agent endpoint
  -> no hard-coded root URL

model-bearing root
  -> active brand model override
  -> specialist registry default
  -> compiled global fallback
  -> complete Eve selection
  -> merged provider options
  -> trusted Gateway user and registry tags
`

The resolver returns the compiled fallback on lookup or configuration failure. It never silently changes the model id.

## Concrete Product Marketer task kind

`ts
const productMarketerEnrichBrandContext = {
  kind: "product-marketer.enrich-brand-context",
  workerKey: "product-marketer",
  executionMode: "agent",
  activation: "automatic",

  briefSchema: {
    baselineContextObjectId: ObjectId,
  },

  outputContract: [
    "brand_context",
    "report",
  ],

  completionResultSchema:
    ProductMarketerResult | { outcome: "no-change"; reason: "already-current" },

  requiredOutputObjectIds(result) {
    if (result.outcome === "reported") {
      return [
        result.brandContextObjectId,
        result.reportObjectId,
      ];
    }

    return [];
  },

  subjectKey(payload) {
    return \`brand-context:${payload.baselineContextObjectId}\`;
  },

  requires: [],

  schedulableBy: ["agent"],
  acceptsPlanRouteOrigin: false,
  intentAcceptance: false,
  budgetClass: "standard",
};
`

The root receives the pinned baseline Context Object and the immutable common Intent snapshot. It may read the current same-brand graph, but it does not replace the accepted Intent snapshot with a newer revision.

A successful run produces one task-bound \`product_marketer_context_refined\` Action, one \`report\` Object, and one superseding \`brand_context\` Object in a single brain transaction. The report contains normalized positioning, audience, message, competitive observations, claim grades, and source Object ids. The new Brand Context contains the canonical context and references the report Object by id.

A partial or blocked run writes no new Brand Context. It stages a successful domain completion with one to three bounded questions.

`ts
type ProductMarketerTaskResult =
  | {
      readonly outcome: "reported";
      readonly reportObjectId: ObjectId;
      readonly brandContextObjectId: ObjectId;
    }
  | {
      readonly outcome: "no-change";
      readonly reason: "already-current";
    };

type ProductMarketerQuestionCompletion =
  | TaskCompletion<ProductMarketerTaskResult> & {
      readonly status: "partial" | "blocked";
      readonly result: {
        readonly outcome: "no-change";
        readonly reason: "already-current";
      };
      readonly openQuestions: readonly [
        OpenQuestion,
        ...OpenQuestion[],
      ];
    };
`

\`intent_acceptance\` is always \`null\`. The task cannot create a Decision, approval, provider commitment, schedule, or Phase 1 external operation.

## Implementation sequence

Each unit ends with a real check.

1. Remove the generic \`apps/agent\` assumption and define the seven-root registry manifest. Verify manifest uniqueness, root health contracts, exact Eve version parity, and unsupported-kind fail-closed behavior.

2. Add \`packages/env\` and \`packages/db\`. Verify empty-database migrations, previous-release migrations, PostgreSQL 17 constraints, same-brand foreign keys, cascading deletion, singleton indexes, and no forbidden tables.

3. Add branded domain schemas and boundary parsers. Verify positive and negative parsing for every closed schema.

4. Add \`packages/policy\` as pure functions. Verify the role matrix, null-structure branch, Intent structure levels, exact preauthorization revision binding, and deny-by-default system Actors.

5. Add \`packages/brain\` brand, Actor, Intent, Action, Object, and replay operations. Verify receipt-first replay, stale revisions, provenance, singleton supersession, and cross-tenant rejection.

6. Add deterministic URL normalization and Context.dev/Blob adapters. Verify the versioned normalization label, operation-key derivation, idempotent Blob keys, provider failure behavior, and absence of provider I/O in transactions.

7. Add the Product Marketer registry kind and shared model resolver. Verify successful report completion, partial and blocked questions, required-output normalization, resolver fallback, Gateway attribution, \`reasoning: "high"\`, and compaction default \`0.9\`.

8. Add task insertion and dispatcher claim. Verify active-task deduplication, immutable Intent snapshots, zero-credit admission, payload-free dispatch, root-kind filtering, and no task or brand selector in the dispatch route.

9. Add the Product Marketer Eve root and root-only settlement. Verify one authoritative session binding, no child settlement, staged completion, terminal success, technical failure, and unbound handoff recovery.

10. Add CMO conversation ownership, proxy authorization, consultation, refinement, and task-question resolution. Verify owner privacy, viewer restrictions, exact-turn cancellation, no transcript leakage, and no old-task resumption.

11. Add the browser journeys and canonical-row assertions. Verify browser to Server Action/proxy to brain to PostgreSQL to rendered projection.

12. Add root scripts and CI. Run \`pnpm check\`, \`pnpm check-types\`, \`pnpm test\`, \`pnpm test:integration\`, \`pnpm test:e2e\`, and \`pnpm build\` from the repository root. Run the hosted canary separately and never merge its evidence into the local predicate.

## Rationale

### Problem

The current checkout is still scaffold-heavy. \`apps/app\` and \`apps/web\` are starter Next.js applications, \`apps/agent\` only declares Eve, and the planned database, brain, policy, registry, migrations, fixtures, CI, and browser harness do not yet exist. Phase 0 must establish a real vertical slice without violating the fixed graph, tenancy, privacy, replay, and provider boundaries.

### Usage

The caller uses \`apps/app\` boundaries for authentication and request parsing. It calls typed \`packages/brain\` operations with the exact \`brandId\` and trusted authorization context. The CMO uses the same domain boundary through a narrower interactive context. Product Marketer execution uses the same registry contracts through one-shot task mode.

### Shape

The design uses PostgreSQL as the canonical graph and \`packages/brain\` as the only canonical writer. Better Auth remains the identity and organization source. The current Member is reloaded at every application boundary.

The core shape is a discriminated task origin, a typed registry task kind, branded identifiers, immutable Intent snapshots, and a normalized \`TaskCompletion\`. Invalid origin combinations, cross-brand ids, non-null Phase 0 Intent acceptance, and unbounded question completions are rejected at parsing or construction time.

Policy is pure. Database, Eve, provider, and framework types do not cross the domain boundary. External data is parsed once at the application adapter. Internal code trusts the parsed types.

The public brain functions are deep modules. They hide replay lookup, advisory locking where needed, tenant rechecks, Policy evaluation, provenance, same-brand constraints, and canonical Action/Object writes. Callers do not coordinate several repository calls to complete one operation.

The Product Marketer kind is deliberately narrow. It reads one pinned Context Object and one immutable Intent snapshot. It either creates a report plus a new Brand Context or ends successfully with bounded questions. It does not introduce a commitment, Decision, schedule, generic artifact inventory, or task-question workflow of its own.

The chosen shape has a short runtime path.

`text
application boundary
  -> brain operation
  -> one transaction
  -> canonical row
`

Eve execution adds only the required task lifecycle.

`text
payload-free dispatch
  -> atomic claim
  -> one task-mode session
  -> finishTask staging
  -> authoritative settlement
`

### Synthesis decision

This is a whole-shape candidate for arena comparison. It recommends the brain-facade shape because it concentrates policy, replay, provenance, and transaction behavior behind domain operations while keeping package dependencies one-directional.

The synthesis should preserve the Product Marketer task as a concrete falsifiable vertical slice. It should not replace it with a generic task framework before the successful and partial/blocked paths are proven.

### Tradeoffs accepted

- We accept one deep \`packages/brain\` boundary in exchange for preventing every application and root from becoming an alternate graph writer.
- We accept ordinary SQL projections in exchange for avoiding a materialized-state table and projection-rebuild protocol.
- We accept one Product Marketer task that emits two related Objects in one transaction in exchange for keeping report provenance and the Brand Context singleton independently queryable.
- We accept the five-minute unbound delivery ambiguity in exchange for not introducing a partially enforced handoff-generation protocol.
- We accept no automatic rerun after an accepted Eve session in exchange for one authoritative task session and one terminal completion.
- We accept no local fake provider in production builds in exchange for deterministic CI without false capability.
- We accept a health-only surface for five roots in exchange for building the complete seven-root registry now without claiming unsupported Phase 0 behavior.
- We accept a small additive \`packages/test-support\` package because repeatable PostgreSQL, clock, and scripted-provider checks are needed to prove the real boundaries.

### Alternatives considered

- Direct application-to-Drizzle writes lost because they expose storage and Policy details to every caller. They create multiple graph writers and make tenant scoping a convention.
- A generic repository and unit-of-work layer lost because it is shallow. Callers would still coordinate reads, replay checks, Policy, and writes, while Drizzle and storage representations leak upward.
- An event bus with separate projection tables lost because it introduces another canonicalization and replay layer. Phase 0 requires PostgreSQL graph queries and no materialized-state table.
- A single generic Product Marketer report Object lost because it cannot express the canonical Brand Context singleton and its supersession without making consumers reconstruct current context from reports.
- A broad task framework with generic \`result: unknown\` lost because it weakens the registry contract. The concrete kind needs closed payload, outputs, completion, and required-output behavior before generalization.

### Open questions and risks

- Should the report Object content use a stricter claim schema before implementation, or is the Phase 0 normalized report schema sufficient?
- Should Product Marketer report and Brand Context be produced by one Action or two task-bound Actions, given that both are committed atomically and share the same task provenance?
- Which exact Context.dev fields are required for the first local scripted fixture?
- Should the initial non-commercial alpha grant be seeded in the same brand transaction or by an explicit migration fixture?
- Which health fields should be exposed publicly without revealing deployment secrets?
- Can the current installed Eve 0.31.3 and AI SDK versions prove \`reasoning: "high"\` and compaction default \`0.9\` locally, or must that evidence remain only in the canary?
- Which visual references define the first responsive console shell once the canonical data path is working?

### Next implementation step

Build the empty PostgreSQL migration, branded schemas, and the \`declareIntent → Context bootstrap → Product Marketer task\` contract tests before implementing the UI.

## Red-flag screen

- **Shallow modules.** The brain operations own replay, Policy, provenance, and transaction semantics. No public repository or pass-through service is proposed.
- **Information leakage.** Eve, Drizzle, Better Auth, Context.dev, Blob, and transport payloads are parsed or adapted at boundaries. Domain callers receive branded domain types.
- **Temporal decomposition.** Modules are organized around brands, Intents, tasks, Objects, conversations, schedules, and registry knowledge. They are not organized as load, validate, transform, and save stages.
- **Pass-through methods.** The application shell performs authentication and parsing, then invokes one deep brain operation. The dispatcher owns claim, delivery, and settlement. No forwarding layer repeats the same signature.

## Contract deviations

None. The candidate preserves the fixed data shape and boundaries.

It introduces no receipt table, message table, Intent-version table, team table, brand-membership table, or materialized-state table. The Product Marketer report and Brand Context are ordinary canonical Objects. Replay receipts remain Action fields containing \`operation_key\` and \`request_hash\`.

## Principles applied

- **Foundational Thinking** selected branded domain types, immutable snapshots, and the registry before UI work.
- **Model the Domain** selected discriminated task origins, closed task kinds, and a registry instead of scattered conditionals.
- **Type System Discipline** selected branded ids, closed unions, and parsed boundary values.
- **Boundary Discipline** kept authentication, provider parsing, Blob handling, and Eve transport at the shell.
- **Separate Before Serializing Shared State** kept each root independently dispatched and left PostgreSQL as the only shared coordination point.
- **Make Operations Idempotent** selected Action receipts, fill-or-match completion, stable Blob keys, and one authoritative task session.
- **Laziness Protocol** rejected generic repositories, aliases, materialized state, and speculative Phase 1 controls.
- **Minimize Reader Load** selected domain-owned modules and short application-to-brain call chains.
- **Subtract Before You Add** retained the existing scaffold only as a temporary build target and excluded unneeded framework layers.
- **Outcome-Oriented Execution** sequences work toward the complete local Phase 0 predicate rather than preserving fixture-only intermediate states.
- **Exhaust the Design Space** shaped the alternatives comparison and required a concrete Product Marketer vertical slice.
- **Experience First** made the browser-to-canonical-row journey and private CMO behavior acceptance criteria.
- **Build the Lever** made PostgreSQL fixtures, controlled clocks, scripted providers, migration checks, and root verification reusable artifacts.
- **Sequence Work into Verifiable Units** orders each foundation behind a real check.
- **Prove It Works** requires browser, application, Eve, database, and canonical-row evidence rather than green compilation alone.
- **Encode Lessons in Structure** puts replay, tenancy, output, model, and provider restrictions in types, constraints, registry contracts, and CI.
- **Redesign from First Principles** treats the Phase 0 requirements as foundational instead of bolting them onto the existing starter apps.
- **Guard the Context Window** keeps the candidate centered on one falsifiable Product Marketer task and avoids speculative later-phase contracts.

### Sources used for prior repository grounding

The memory pass was used only to identify the known scaffold baseline and the need to re-check current normative files. The current checkout was then read directly.

<oai-mem-citation>
<citation_entries>
MEMORY.md:299-310|note=[prior Phase 0 scope and scaffold baseline used to target current files]
MEMORY.md:313-316|note=[prior warning to verify executable proof against the scaffold]
</citation_entries>
<rollout_ids>
</rollout_ids>
</oai-mem-citation>
