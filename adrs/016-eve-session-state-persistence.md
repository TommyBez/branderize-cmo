# ADR-016 — eve `SessionState` persistence behind Branderize logical keys

**Status:** Accepted — 2026-08-06
**Amends:** ADR-014 D2 (session binding), ADR-008 §4 (continuation-token terminology)
**Refs:** ADR-009; eve 0.30.8 bundled docs (`guides/client/continuations.mdx`); eve upstream change [`40b09e6`](https://github.com/vercel/eve/commit/40b09e60d9202ec0fa57030c647b2eb61354ef95) (unreleased when this ADR was accepted)

## Context

ADR-014 treated two deterministic product identifiers as if they were eve continuation tokens:

- `cmo:<brand_id>` for the standing CMO conversation;
- `task:<task_id>` for a specialist work item.

That does not match the eve 0.30.8 TypeScript client contract. eve creates and advances the resume and stream handles; the client exposes them together as a `SessionState`:

```ts
interface SessionState {
  continuationToken?: string;
  sessionId?: string;
  streamIndex: number;
}
```

The bundled guide requires applications that control persistence to store the full state and pass it back to `client.session(savedState)`. A `SessionState` is a runtime cursor, not a product identifier or chat transcript. The already-merged next public API removes `continuationToken` from the client surface and uses fixed `sessionId` handles, so the version-specific shape must not leak into the domain.

## Decisions

### D1 — Branderize keys identify the binding record

The stable logical keys remain deterministic functions of product work:

- standing CMO conversation: `cmo:<brand_id>`;
- specialist execution: `task:<task_id>`.

They are **logical keys owned by Branderize**. They select an application record; they are not values passed to eve as `continuationToken` or `sessionId`.

### D2 — Persist the latest complete `SessionState`

`agent_session_states` stores at most one current adapter state per logical key:

```text
{ brand_id, logical_key, adapter_version, session_state JSONB, updated_at }
PRIMARY KEY (brand_id, logical_key)
```

For the eve 0.30.8 adapter, `session_state` is the complete serialized `SessionState`, including `continuationToken`, `sessionId`, and `streamIndex`. The adapter:

1. loads the row by Branderize logical key;
2. creates the client session with `client.session(savedState)`, or without saved state on the first turn;
3. sends and consumes the response;
4. upserts the resulting `session.state` after the turn boundary, when the token and cursor are fully advanced.

If the product needs cancellation or stream reconnection while a turn is still running, the adapter may also persist the accepted in-flight `sessionId` immediately after `send()` returns, then replace the row with the fully advanced state after consuming the response.

### D3 — eve state remains adapter-private

Only the eve adapter imports `SessionState`, reads its fields, or serializes `session_state`. Domain code passes a logical key and never generates, parses, or compares eve handles.

`session_events` and `chat_messages` remain the durable event and conversation projections. `agent_session_states.session_state` is only a client cursor and must not be used as chat history or as the system of record for work.

### D4 — Version-specific state changes only inside the adapter

The 0.30.8 adapter temporarily persists `continuationToken` because it is part of that version's required `SessionState`. When Branderize adopts the fixed-`sessionId` API, only the adapter's serialized representation and migration change. The logical keys and callers do not.

## Consequences

- ADR-014's "no sessions mapping table is needed" decision is superseded only for the current client binding: the latest `SessionState` must be stored.
- `cmo:<brand_id>` and `task:<task_id>` remain stable Branderize lookup keys, not deterministic eve tokens.
- eve preview API changes are isolated to the adapter and its opaque JSON state.

## Out of scope

This ADR does not decide retry semantics, terminal-session recovery, runtime generations, rehydration policy, authentication, session ownership authorization, tenant ACLs, membership checks, or database query scoping. Those require separate decisions.
