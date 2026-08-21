# Phase 0 operations runbook

This runbook covers the locally implemented Phase 0 and its separate hosted
canary. PostgreSQL remains the canonical audit and product state. PostHog and
Vercel logs are diagnostics only.

## Runtime and deployment matrix

Every project uses Node `24.x` and pnpm `11.22.0`. Builds use the native Next.js
or Eve command declared by that workspace. Do not add a custom release
coordinator or a second queue.

| Project root | Runtime location | Database | Deployment responsibility |
| --- | --- | --- | --- |
| `apps/web` | globally static | none | public landing and sign-in entry |
| `apps/app` | `fra1` | pooled plus direct migration URL | migrate, serve the console, proxy the CMO, fan out the minute Cron |
| `apps/agent-cmo` | `fra1` | pooled only | private CMO runtime |
| `apps/agent-product-marketer` | `fra1` | pooled only | durable Product Marketer tasks |
| five remaining `apps/agent-*` roots | `fra1` | pooled only | health and registry contracts only in Phase 0 |

Production uses the production Neon project and private Blob store.
Development, canary, and previews use the non-production project and private
store. A pull request gets an ephemeral Neon branch
(`preview/<git-branch>`) from the shared project. Closing the pull request
invokes `.github/workflows/cleanup-neon-preview.yml` for that exact branch.

Each developer uses a dedicated persistent branch in the non-production Neon
project. Local `DATABASE_URL` uses its pooled endpoint and local
`DIRECT_DATABASE_URL` uses its direct endpoint only for migrations. Starting an
application locally must not start Docker. Docker is reserved for the automated
integration and E2E harnesses below.

Only `apps/app` receives `DIRECT_DATABASE_URL`. Agent roots must reject an
environment containing it. All database consumers receive pooled
`DATABASE_URL`. Both Neon projects and both Blob stores belong in the EU
locations fixed by the implementation plan.

## Environment contract

Use separate secret values per production and non-production environment. The
following values are required by `apps/app`:

- `BETTER_AUTH_SECRET`, at least 32 characters;
- `BETTER_AUTH_URL` and comma-separated `BETTER_AUTH_TRUSTED_ORIGINS`, HTTPS in
  production;
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in preview and production; the sender
  mailbox must belong to a domain verified in Resend;
- `BLOB_STORE_ID`, identifying the environment-specific private Blob store for
  Vercel OIDC operations;
- pooled `DATABASE_URL` and unpooled `DIRECT_DATABASE_URL`;
- `CMO_BRIDGE_SECRET`, `CRON_SECRET`, and `DISPATCH_SECRET`, each at least 32
  characters;
- `CONTEXT_DEV_API_KEY`;
- `AGENT_CMO_URL`, `AGENT_PRODUCT_MARKETER_URL`, `AGENT_CONTENT_URL`,
  `AGENT_DISTRIBUTION_URL`, `AGENT_SEO_DISCOVERY_URL`,
  `AGENT_LIFECYCLE_URL`, and `AGENT_GROWTH_URL`;
- `NEXT_PUBLIC_APP_URL`.

The CMO root receives `CMO_BRIDGE_SECRET`, pooled `DATABASE_URL`,
`DISPATCH_SECRET`, and only `AGENT_PRODUCT_MARKETER_URL` from the endpoint
fleet. Every other root receives only pooled `DATABASE_URL` and
`DISPATCH_SECRET`. `apps/app` retains all seven endpoint URLs for the CMO proxy
and Cron fan-out. Hosted AI Gateway and Blob access use Vercel OIDC. Do not add
long-lived Gateway or `BLOB_READ_WRITE_TOKEN` credentials.

## Local manual verification

Local application startup uses the dedicated Neon development branch and real
Development credentials. It does not use the automated PostgreSQL fixture.

From `apps/app`, link the non-production Vercel project and pull its Development
environment. Vercel writes `VERCEL_OIDC_TOKEN` and the project's Development
variables to the ignored `.env.local` file:

```sh
cd apps/app
vercel link
vercel env pull .env.local
```

The local OIDC token is short-lived. Repeat `vercel env pull .env.local` when
Sandbox, Blob, or AI Gateway reports expired Vercel authentication.

For `pnpm dev:local`, that file needs `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BLOB_STORE_ID`, `CMO_BRIDGE_SECRET`, `CRON_SECRET`, `DISPATCH_SECRET`,
`CONTEXT_DEV_API_KEY`, and `VERCEL_OIDC_TOKEN`. `DATABASE_URL` must be the pooled
URL for the developer's persistent Neon branch. The runner supplies the local
application and agent origins. It also enables the guarded local OTP mode and
removes Resend credentials from the app process. Add the branch's direct URL as
`DIRECT_DATABASE_URL`, then run the migration as an explicit operation:

```sh
node --env-file=.env.local --run=db:migrate
cd ../..
```

Application startup never performs that migration. Start the whole local fleet
from the repository root:

```sh
pnpm dev:local
```

The supervisor validates the required variables without printing their values,
checks all ports before spawning anything, and stops the fleet when one process
fails or when it receives `Ctrl-C`. It fixes these local addresses:

| Process | Address |
| --- | --- |
| public web | `http://localhost:3000` |
| authenticated app | `http://localhost:3001` |
| CMO | `http://127.0.0.1:2000` |
| Product Marketer | `http://127.0.0.1:2001` |
| Content | `http://127.0.0.1:2002` |
| Distribution | `http://127.0.0.1:2003` |
| Growth | `http://127.0.0.1:2004` |
| Lifecycle | `http://127.0.0.1:2005` |
| SEO Discovery | `http://127.0.0.1:2006` |

The runner starts Eve with `--no-ui` because one terminal cannot own seven
interactive TUIs. Each Eve root remains a normal development server. Its
sandbox backend is the shared pinned Vercel backend, so the first sandbox use
creates hosted Vercel compute with the pulled Development OIDC token. The
runner never starts Docker and never falls back to a local sandbox backend.

Check the product manually in this order:

1. Open the public site and follow its console link.
2. Submit any valid email address, then enter any non-empty code of up to six
   characters. The local runner must not send an email.
3. Complete onboarding with a real website. Confirm that Context.dev imports
   it and that the private Blob-backed Brand Context becomes available.
4. Open the CMO, send a message, and confirm that the conversation remains
   usable after moving to another console section and back.
5. Request Product Marketer work. Follow the resulting Work item through its
   question or completion state and open the resulting Brand Context Object.
6. Visit Context, Work, Intent, CMO, conversation, task, and Object pages through
   their visible links. Client navigation should show the destination shell
   immediately while uncached data streams inside its local `Suspense`
   boundary.

Local authentication deliberately skips delivery. The bypass marker exists
only in the app process created by `pnpm dev:local`, and the server accepts it
only with `NODE_ENV=development`, `VERCEL_ENV=development`, and a loopback HTTP
auth origin. Preview, production, and automated tests use hashed six-character
OTPs delivered through the React Email template and Resend. Neon remains a real
non-production branch and sandboxes remain real Vercel Sandboxes. Keep
automated fixture results and this manual development check separate.

Production telemetry additionally uses:

- `NEXT_PUBLIC_POSTHOG_KEY`, a `phc_` project token;
- `POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID` for source-map upload;
- optional `POSTHOG_CLI_HOST`, only when set to `https://eu.posthog.com`.

The runtime gates PostHog and OTLP export on both `NODE_ENV=production` and
`VERCEL_ENV=production`. Preview, development, test, and CI must make no
PostHog request. Session Replay, person profiles, autocapture, and feature flags
remain disabled.

## Pre-deployment gate

From a clean dependency installation, run:

```sh
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm check-types
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

The integration and E2E runners require Docker and PostgreSQL 18. Local E2E
starts the public web app on port 3000 and the console on port 3001. A local
scripted-provider pass proves deterministic boundaries; it does not replace the
hosted canary.

Before promotion, also confirm:

1. `node scripts/check-runtime-contract.mjs` reports the exact Node, pnpm, Eve,
   workspace, and lockfile contract.
2. `node scripts/check-deployment-contract.mjs` reports one payload-free minute
   Cron, `fra1` roots, skill materialization before every Eve build, and no
   direct database URL in an agent.
3. `apps/app` retains the exact `next build` command.
4. The migration log contains only reviewed expand-compatible changes.

## Deployment and health checks

Deploy through the normal Vercel Git integration. `apps/app` runs
`pnpm run db:migrate` before its build; no agent root may run migrations.

After deployment:

1. Request `/eve/v1/health` on all seven agent roots and require a successful
   response with the expected root identity.
2. Authenticate to the console and open one authorized brand projection.
3. Invoke `GET /api/internal/cron/dispatch` with `Authorization: Bearer
   $CRON_SECRET`. The request must contain no body, query, brand, task, worker,
   or schedule selector. It returns `200` only after all seven roots acknowledge
   with `202`; a partial fan-out returns `503` with the accepted count.
4. Confirm each root received only the authenticated payload-free
   `/internal/dispatch` poke and acknowledged it with `202` before beginning its
   `waitUntil` drain.
5. Confirm that a failed or slow root does not extend the console fan-out beyond
   the two-second per-root deadline.

Do not treat successful health endpoints as proof of the product journeys.

## Signals and alerts

Use Vercel Runtime Logs for platform failures and PostHog EU only for the closed,
sanitized operational schema. Every emitted record carries a trusted or hashed
correlation identifier. Never export prompts, model output, CMO transcripts,
request bodies, provider secrets, raw email addresses, or canonical payloads.

Create dashboards and alerts for these failure families:

| Failure family | Canonical or diagnostic signal | Alert condition |
| --- | --- | --- |
| authentication | handled auth error and HTTP status | sustained sign-in or membership failures |
| Context import | import status plus handled provider/asset error | failed bootstrap or repeated retry without a Brand Context head |
| Blob delivery | authorized route status | unexpected 5xx or cross-brand authorization failure |
| dispatch | Cron result and per-root operational log | root timeout, non-202 response, or repeated fleet failure |
| durable task | task status and terminal Action | queued backlog, running task past recovery window, or `DELIVERY_FAILED` |
| Eve settlement | `session_events`, task status, and handled error | root terminal event without valid settlement or completion |
| model cost | append-only `credit_ledger` | winning priced step without exactly one charge, or negative balance |
| telemetry transport | best-effort exporter error | sustained loss of PostHog or OTLP transport only; never mutate canonical state |

When investigating a task, correlate its task id, generation `started_at`, root
session id, sanitized correlation id, terminal Action, and ledger entries. Raw
Eve events are retained by event id. A retried coordinate can have a new event
id, so cost investigation must use the winning terminal projection rather than
counting every raw step.

## Recovery

### Context import

Leave the brand onboarding state incomplete when Context.dev, asset validation,
or Blob upload fails. Fix the provider or environment issue, then use the
explicit retry. The stable bootstrap key makes an exact retry idempotent. Never
manufacture an empty Brand Context.

### Product Marketer delivery

A claimed task that was never bound to an Eve session becomes recoverable after
five minutes. The recovery path may return only that stale, unbound generation
to the queue or fail that exact generation with `DELIVERY_FAILED`. A task already
bound to a session is unchanged. The generation-specific Eve address prevents a
reclaim from resuming the stale session.

### Root or provider outage

The immediate post-commit poke is an optimization. Leave the task queued and
allow the sole minute Cron to poke the fleet again. Do not create a second queue
or send a task selector. Resolver failure uses the compiled exact-model fallback;
provider failure remains visible and follows the ordinary retry path.

Only a `created` Product Marketer receipt sends the immediate poke. An exact
receipt replay sends the payload-free poke again because the first attempt may
have failed. Observing another active task sends no poke. A missing endpoint,
timeout, transport failure, or response other than `202` returns a closed
`deferred` outcome without changing the canonical receipt. The minute Cron is
the recovery path.

### Telemetry outage

PostHog and OTLP transports fail open. Preserve PostgreSQL Actions, receipts,
raw session events, and credit entries. Restore telemetry independently and do
not reconstruct product truth from analytics.

## Rollback

Use expand/contract migrations. Never roll back by deleting migration history,
Actions, Objects, task completions, session events, operation receipts, or credit
entries.

For an application or agent regression:

1. stop promotion and preserve the current database;
2. redeploy the last compatible application/root build;
3. leave queued work queued and let the normal lease/recovery rules settle
   claimed work;
4. verify reads against both pre-change and expanded rows;
5. ship a forward repair before later contracting unused columns.

Schedule-template retirement is the exception: deploy roots that no longer emit
the template, wait for quiescence, then deploy the console/schema change. If it
must be rolled back, restore the compatible roots before re-enabling the
template. Do not make a historical receipt writable to simplify rollback.

## Hosted canary checklist

Status at implementation handoff: **not verified**. A local deterministic pass
cannot close the Phase 0 exit gate.

Run this checklist in the shared non-production environment:

- A Resend-delivered email OTP creates or resumes the intended user and
  organization without exposing whether the address already existed.
- Context.dev imports the target site, every accepted asset is mirrored to the
  non-production private Blob store, and cross-brand delivery fails closed.
- Neon contains the expected Actor, Intent, Action, Object, conversation, task,
  session-event, and credit provenance.
- The CMO and Product Marketer both resolve
  `deepseek/deepseek-v4-pro-0813` through AI Gateway with trusted brand and
  registry attribution.
- The provider accepts `reasoning: high`, returns a real reasoning signal, and
  reports no warning, remap, or cross-model fallback.
- The Product Marketer creates at least one task-linked `brand_context` Object;
  a partial or blocked result creates none and retains its questions.
- The real minute Cron recovers a missed immediate poke without carrying a
  selector.
- Preview emits zero PostHog traffic.
- Production smoke sends one allowlisted product event, one synthetic handled
  client error, one synthetic handled server error, and one redacted OTLP log.
  It uses no real prompt, body, transcript, or provider payload.
- Private source maps upload to PostHog EU during the production build and are
  removed from the public build output.

Record the deployment ids, timestamps, sanitized correlation ids, canonical row
ids, provider/Gateway metadata, and screenshots or traces. Keep this evidence
separate from deterministic CI results.
