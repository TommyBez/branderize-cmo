# ADR-014 — Schema: singleton keys, deterministic session tokens, derived structure, two streams, ledger granularity, content shape

**Status:** Accepted — 2026-08-05
**Amends:** ADR-002 (schema concreteness), ADR-008 (the audit hook's target tables), ADR-012 (chat history home)
**Amended by:** [ADR-016](016-eve-session-state-persistence.md) (D2: persist eve `SessionState` behind Branderize logical keys)
**Refs:** ADR-007, ADR-011, ADR-013; trycompai/crm `channels/crm.ts` (deterministic continuation tokens); eve bundled docs (`concepts/sessions-runs-and-streaming.md`, `concepts/execution-model-and-durability.mdx`); Vercel Workflows pricing/retention docs

## Context

Third self-grilling round, at schema level. Six questions; three needed re-explanation and one (session retention) surfaced a platform constraint that changes how much we may rely on eve's session storage.

## Decisions

### D1 — Object cardinality: singletons get a database constraint

Object types declare cardinality in the brain's type registry. **Singletons** (`brand_context`, the current strategy Decision): one active per brand; producing the new one supersedes the previous in the same transaction. **Collections** (`artifact`, `evidence`, `proposal`, `move_candidate`): many active; supersession is explicit, per object.

Enforcement is mechanical, not conventional: `objects.singleton_key` (NULL for collection items) plus

```sql
CREATE UNIQUE INDEX objects_singleton_active
  ON objects (brand_id, singleton_key)
  WHERE status = 'active' AND singleton_key IS NOT NULL;
```

The unlikely-but-possible double-write (lease expiry re-running a live task, admin intervention, a future bug) becomes a loud constraint violation instead of silent ambiguity in every downstream "load the brand context". Invariants live in the substrate where the substrate can hold them.

### D2 — Session binding is computed, not stored; eve state is working memory

> **Amended by ADR-016.** The text below records the historical decision. The current contract keeps the deterministic values as Branderize-owned logical keys and stores the latest complete eve `SessionState` for each key in `agent_session_states`. ADR-016 changes only this binding and terminology; the working-memory and cold-start rules below remain unchanged.

From the CRM's `channels/crm.ts`: the continuation token is a **deterministic function of the work**, so no sessions mapping table is needed:

- Specialist runs: `task:<task_id>` — retries re-dispatch the same token and resume the same eve thread for free; the channel's event handlers close the loop (`session.waiting` → `completeTask`; `turn.failed` → settle failed).
- Console chat: **`cmo:<brand_id>`** — one standing, multi-user thread per brand. Every message carries its author's principal (the proxy mints user-principal tokens, ADR-009); the console serializes sends per thread (eve drains one follow-up at a time).

**The platform constraint:** on Vercel, workflow run data is retained per plan (1 day Hobby / 7 Pro / 30 Enterprise after completion; stream chunks TTL 30 days in beta) — `sessionTimeoutMs: false` keeps the token alive but cannot extend the storage underneath. Therefore:

- **eve session state is working memory, never a system of record.** Everything that matters is already in our Postgres: the graph via the write path, telemetry via the audit hook, and the conversation via a permanent, brand-scoped **`chat_messages` projection** fed by the hook's `message.*` events (the console renders chat history from our DB, not from eve).
- The CMO's instructions include a **cold-start procedure**: a fresh session on a brand with history rehydrates from the graph (brand context preamble, open intents, recent actions, recent `chat_messages`). This is the same fresh-session-plus-brief discipline as the specialists, applied to the lead.
- Escape hatch, documented not adopted: `@workflow/world-postgres` backs eve's workflow state with our own Postgres and implements no TTLs. We start on Vercel-managed workflow and migrate only if the TTL bites in production; the cold-start design is required either way.

### D3 — `structure_level` is derived, never stored

A pure function in `packages/policy`: statement only → low; + acceptance criteria → medium; + constraints **and** at least one linked pre-authorizing Decision → high. The value at decision time is recorded in the Action's `policy_snapshot` (replay-safe). No mutable column to drift. Filling the structure fields stays delegable work; the level is a projection — consistent with "state is a projection, never an independent object".

### D4 — Two streams: `actions` vs `session_events`

The partition is decided by **code path, never by the model**:

- **`actions`** — the grammar log, written only by brain write-path functions and boundary executions. This is what provenance, policy replay, and the CI integrity metrics query. Forever retention.
- **`session_events`** — telemetry: every eve stream event, ingested by the audit hook keyed on eve's stable `meta.id` with `ON CONFLICT DO NOTHING` (the idempotent-ingestion pattern eve's docs prescribe; retried steps re-emit under new ids, which is correct). Actions carry `session_id`/`call_id`, so any grammar action traces to its telemetry.

The mental test for the partition: *would a human ever ask "why did this happen, and who authorized it?"* — yes → Action; "what did the model do along the way" → telemetry.

### D5 — `credit_ledger`: three entry types, idempotent by key

- `grant` — monthly pool, purchases, overage
- `session_charge` — one row per closed agent session, usage aggregated from `step.completed` events, priced at AI Gateway rates; idempotency key `session_id`
- `action_charge` — one row per boundary-action execution, priced by action type; idempotency key `action_id`

Unique constraints on the keys make retries safe. The balance is a materialized projection the dispatcher reads before leasing (ADR-011 D4). The ledger is a financial record computed *from* telemetry but independent *of* it — invoices outlive timesheets: `session_events` retention cannot be allowed to destroy billing reproducibility, and pricing changes must not rewrite history.

**Retention is a policy knob, not an architecture decision.** `session_events` is partitioned by month; "archive" concretely means exporting a partition to blob storage (NDJSON, one directory per session) and dropping it — designed, not implemented, until storage cost or privacy (reasoning events may hold sensitive reasoning; eve's own docs flag this) forces the issue.

### D6 — `objects` content shape: three columns, three jobs

- `content JSONB` — machine-readable, validated per type by the write path's zod schemas (ADR-012's `output_contract`)
- `content_text TEXT` — the per-type human-readable projection, with a generated `tsvector` column powering the graph browser's full-text search
- `blob_key` — pointer to content-addressed blob storage for binaries (ADR-011 D6)

## Deferred notes

- **RLS** stays deferred: explicit `brand_id` plus the single write path is the primary defense; serverless pooling makes per-transaction RLS context costly. Revisit if the console ever queries outside the brain.
- Task dedup gets its own partial unique index: `(kind, brand_id, subject_key) WHERE status IN ('queued','leased')` — the constraint *is* the dedup.
