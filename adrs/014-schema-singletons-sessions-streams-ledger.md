# ADR-014 — Schema: singleton keys, session ownership, derived structure, two streams, ledger granularity, content shape

**Status:** Accepted — 2026-08-05
**Amends:** ADR-002 (schema concreteness), ADR-008 (the audit hook's target tables), ADR-012 (chat history home)
**Amended by:** [ADR-016](016-eve-session-state-persistence.md) (D2: persist the human fixed `session_id` and `stream_index` on its conversation; keep task addressing inside the custom channel); [ADR-017](017-consultative-subagents-durable-root-work.md) (durable task identity and recheck staging); [ADR-018](018-one-shot-durable-agent-tasks.md) (explicit task status, one-shot agent sessions, and producer idempotency)
**Amended by:** [ADR-019](019-human-approved-external-commitments.md) (executable proposals move from Objects to tasks; human direct states, approval/result links, and tenant cascades join the schema)
**Refs:** ADR-007, ADR-011, ADR-013; trycompai/crm `AgentConversation`, `ConversationsService`, and `channels/crm.ts`; eve 0.31.3 bundled docs (`guides/client/continuations.mdx`, `guides/client/overview.mdx`, `channels/eve.mdx`, `concepts/sessions-runs-and-streaming.md`, `concepts/execution-model-and-durability.mdx`); Vercel Workflows pricing/retention docs

## Context

Third self-grilling round, at schema level. Six questions; three needed re-explanation and one (session retention) surfaced a platform constraint that changes how much we may rely on eve's session storage.

## Decisions

### D1 — Object cardinality: singletons get a database constraint

Object types declare cardinality in the brain's type registry. **Singletons** (`brand_context`, the current strategy Decision): one active per brand; producing the new one supersedes the previous in the same transaction. **Collections** (`artifact`, `evidence`, `move_candidate`): many active; supersession is explicit, per object. An executable proposal is no longer an Object collection item; ADR-019 represents it as a human-activation direct task.

Enforcement is mechanical, not conventional: `objects.singleton_key` (NULL for collection items) plus

```sql
CREATE UNIQUE INDEX objects_singleton_active
  ON objects (brand_id, singleton_key)
  WHERE status = 'active' AND singleton_key IS NOT NULL;
```

The unlikely-but-possible double-write (a retry-safe direct/automatic lease expiry overlapping a live handler, an interrupted eve step replaying inside one accepted run, admin intervention, or a future bug) becomes a loud constraint violation instead of silent ambiguity in every downstream "load the brand context". Human external commitments do not use lease reclaim. Invariants live in the substrate where the substrate can hold them.

### D2 — The owning record stores eve binding; eve state is working memory

> **Amended by ADR-016 and ADR-018.** Branderize separates application identity from eve runtime identity. A CMO conversation owns its eve-generated fixed `session_id` and `stream_index`; a durable agent task owns one authoritative bound `session_id`, while its custom channel owns the deterministic channel-local address. The narrow accepted-before-binding ambiguity is recorded in ADR-018 D3. There are no prefixed application lookup strings, opaque human `session_state`, or polymorphic session-state mapping table.

The CRM precedent has two distinct paths:

- Human chat: `AgentConversation.id` supplies the useful application/runtime identity split. Branderize's current eve 0.31.3 client binding stores only the public fixed-session cursor `{ sessionId, streamIndex }`, mapped to `cmo_conversations.session_id NULL UNIQUE` and `stream_index NOT NULL DEFAULT 0`. The application id remains the URL and ownership key; only the single `owner_user_id` may write, while a brand may have many owner-scoped conversations. Whether another brand member may read one is a separate ACL decision.
- Automated work: the durable task remains the product and run identity. Its custom channel derives `task:<task_id>`, attempts delivery with `mode: "task"`, and binds the authoritative `session_id` on the task through `session.started` plus post-send. Only a stale unbound handoff may send again. Domain code never uses the token as a lookup key, and a later product retry is a new task rather than a continuation of the failed session.

**The platform constraint:** on Vercel, workflow run data is retained per plan (1 day Hobby / 7 Pro / 30 Enterprise after completion; stream chunks TTL 30 days in beta) — `sessionTimeoutMs: false` keeps the token alive but cannot extend the storage underneath. Therefore:

- **eve session state is working memory, never a system of record.** Everything that matters is already in our Postgres: the graph via the write path, telemetry via the audit hook, application-owned CMO conversation rows, and a permanent **`chat_messages` projection scoped by both `brand_id` and `conversation_id`** fed by the hook's `message.*` events (the console renders chat history from our DB, not from eve).
- A waiting human session continues only by `client.sessions.attach(session_id, { streamIndex })` followed by `send()`. A terminal, reset, or unavailable conversation remains readable from `chat_messages`; starting again explicitly creates a new application conversation and calls `client.sessions.create({ message })`. Neither the eve client nor our adapter rebinds the old row or follows a replacement automatically.
- Escape hatch, documented not adopted: `@workflow/world-postgres` backs eve's workflow state with our own Postgres and implements no TTLs. We start on Vercel-managed workflow and migrate only if retention becomes a product constraint; permanent transcripts do not depend on that choice.

### D3 — `structure_level` is derived, never stored

A pure function in `packages/policy`: statement only → low; + acceptance criteria → medium; + constraints **and** at least one linked pre-authorizing Decision → high. The value at decision time is recorded in the Action's `policy_snapshot` (replay-safe). No mutable column to drift. Filling the structure fields stays delegable work; the level is a projection — consistent with "state is a projection, never an independent object".

### D4 — Two streams: `actions` vs `session_events`

The partition is decided by **code path, never by the model**:

- **`actions`** — the grammar log, written only by brain write-path functions and boundary executions. This is what provenance, policy replay, and the CI integrity metrics query. Append-only for the brand's lifetime; brand deletion cascades it with the rest of the tenant data (ADR-019).
- **`session_events`** — telemetry: every eve stream event, ingested by the audit hook keyed on eve's stable `meta.id` with `ON CONFLICT DO NOTHING` (the idempotent-ingestion pattern eve's docs prescribe; retried steps re-emit under new ids, which is correct). Actions carry `session_id`/`call_id`, so any grammar action traces to its telemetry.

The mental test for the partition: *would a human ever ask "why did this happen, and who authorized it?"* — yes → Action; "what did the model do along the way" → telemetry.

### D5 — `credit_ledger`: three entry types, idempotent by key

- `grant` — monthly pool, purchases, and later settlement/top-up of overage; a grant is not required in advance of a human-approved charge
- `session_charge` — one row per closed agent session, usage aggregated from `step.completed` events, priced at AI Gateway rates; idempotency key `session_id`
- `action_charge` — one row only for a billable Execution/Result Action whose task reached `succeeded` with a validated stable provider receipt; idempotency key `action_id`. Its amount and pricing version come from the authorization snapshot, not the current price table. `failed`, `outcome_unknown`, `expired`, `cancelled`, and `needs_regeneration` produce no charge. A later Verification Action never backfills the unknown commitment's charge in v1; it is billable only when its own registered operation is separately chargeable

Unique constraints on the keys make replay of a charge projection safe. The balance is a materialized projection the dispatcher reads before an **agent-lane** claim (ADR-011 D4); it is not an eligibility condition for either direct lane. A human-approved boundary call therefore proceeds at zero pool balance. When it reaches billable `succeeded`, its Result Action, task settlement, and one `action_charge` commit in the same transaction under `UNIQUE(action_id)`; every other outcome commits its Result Action and settlement without a charge. The debit may make the balance negative: the negative amount is payable overage, later settled by billing rather than a credit grant that must exist before execution. `session_charge` derives from telemetry and `action_charge` derives from the durable successful boundary Action; ordinary telemetry retention can rewrite neither. Brand-scoped ledger rows still follow ADR-019's tenant cascade; any separately retained issued invoice is a billing-layer document, not a surviving work-graph row.

**Retention is a policy knob, not an architecture decision.** `session_events` is partitioned by month; "archive" concretely means exporting a partition to blob storage (NDJSON, one directory per session) and dropping it — designed, not implemented, until storage cost or privacy (reasoning events may hold sensitive reasoning; eve's own docs flag this) forces the issue.

### D6 — `objects` content shape: three columns, three jobs

- `content JSONB` — machine-readable, validated per type by the write path's zod schemas (ADR-012's `output_contract`)
- `content_text TEXT` — the per-type human-readable projection, with a generated `tsvector` column powering the graph browser's full-text search
- `blob_key` — pointer to content-addressed blob storage for binaries (ADR-011 D6)

## Deferred notes

- **RLS** stays deferred: explicit `brand_id` plus the single write path is the primary defense, and v1 keeps authorization in that application boundary rather than maintaining a second policy system in SQL. ADR-005's transaction-capable adapter could support transaction-local database context, so pooling is not the reason for this deferral. Revisit RLS as defense in depth if the console ever queries outside the brain.
- Task active identity uses `(kind, brand_id, subject_key) WHERE status IN ('awaiting_approval', 'queued', 'running')`. A separate creator/occurrence `idempotency_key UNIQUE` plus canonical creation hash deduplicates replay of the request that inserted the task and rejects key reuse with different input. V1 stores no alias keys for distinct requests coalesced onto a row. Human commitments use a proposal-specific subject identity, so this index does not semantically collapse independently intended proposals. A second partial unique index on `(brand_id, commitment_conflict_key) WHERE activation = 'human' AND status IN ('queued', 'running') AND commitment_conflict_key IS NOT NULL` prevents simultaneous approval/execution only for registry-declared non-commutative commands; it is a conflict guard, not proposal deduplication or FIFO.
- Shared fields include registry-derived `execution_mode` and `activation`. Valid combinations are agent/automatic, direct/automatic, and direct/human; agent/human is invalid. ADR-018 holds the agent lifecycle. Only direct/automatic may use `leased_until`, `attempts`, and bounded reclaim. Direct/human adds `awaiting_approval`, `outcome_unknown`, `expired`, `needs_regeneration`, `dismissed`, and `superseded`; it stores revision/payload hash, `approved_at`, plus Approval/Result Action links, while task-linked Cancellation Actions settle atomically without a separate proposal table. `approved_at` is a denormalized lifecycle timestamp written with the Approval Action, not a generic priority. It never uses session state, staged completion, `next_*`, lease, or attempts (ADR-019).
- `tasks` has nullable `next_due_at`, `next_payload`, and `next_rationale` fields only for the single pending successor of an equivalent running agent recheck or a registered direct/automatic kind. They form one tuple and are updated atomically. Human external commitments never stage recurring successors. Agent failure/cancellation or direct/automatic exhaustion clears the tuple and creates no successor. Provider-outcome polling uses distinct occurrence tasks rather than this `next_*` slot (ADR-017, ADR-018, ADR-019).
- Every brand-scoped grammar and runtime table has a real foreign-key path to `brands` with cascading delete. Durability means surviving process/deploy failure, not surviving deletion of the tenant. External provider resources are not part of the cascade.
- Lane-specific partial claim indexes support the ADR-009 admission queries: queued human commitments by root/deadline/`approved_at`/id, eligible automatic-direct rows by root/creation FIFO, and eligible agent rows by root/creation FIFO. Query-plan tests cover the due/status/mode predicates and ordering. There is no generic task-priority column or index.
