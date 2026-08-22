# Branderize CMO

Branderize is a multi-tenant marketing work graph with a private CMO and six specialist agents.

## Requirements

- Node 24.x
- Corepack
- pnpm 11.22.0
- A dedicated Neon development branch for local application data
- Docker only for the automated PostgreSQL integration and E2E suites

This repository uses pnpm 11.22.0 exclusively.

## Setup

```sh
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install --frozen-lockfile
```

## Development

Create a persistent development branch in the non-production Neon project. Set
its pooled connection string as `DATABASE_URL` and its direct connection string
as `DIRECT_DATABASE_URL`. The application uses the pooled URL at runtime; only
Drizzle migrations use the direct URL. Local development never starts a
database container.

Preview and production need `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. The sender
must be a mailbox on a domain verified in Resend. The local supervisor neither
requires these values nor sends email.

Link `apps/app` to its non-production Vercel project and pull the Development
environment into `apps/app/.env.local`:

```sh
cd apps/app
vercel link
vercel env pull .env.local
cd ../..
```

The file must contain the pooled Neon `DATABASE_URL`, the application secrets
listed in the operations runbook, `CONTEXT_DEV_API_KEY`, `BLOB_STORE_ID`, and
`VERCEL_OIDC_TOKEN`. The OIDC token authorizes AI Gateway, Blob, and the hosted
Vercel Sandbox during local development. The local runner does not print their
values. The development OIDC token is short-lived; run `vercel env pull
.env.local` again when Vercel authentication expires.

Run the migration explicitly after adding the direct URL. This command is
separate from application startup:

```sh
cd apps/app
node --env-file=.env.local --run=db:migrate
cd ../..
```

Start the complete local application with one supervisor:

```sh
pnpm dev:local
```

Open `http://web.localhost:1355` for the public site or
`http://app.localhost:1355/sign-in` for the console. The seven Eve roots use
`http://cmo.localhost:1355` through `http://seo-discovery.localhost:1355`.
They run headless and create real hosted Vercel sandboxes when an agent first
needs one. No local Docker daemon is used. The Portless proxy is plain HTTP on
1355, so agents and `pnpm dev:local` never need sudo or a trusted local CA.
`Ctrl-C` stops all nine processes. Local sign-in does not send email: submit an
address, then enter any non-empty code of up to six characters.

## Verification

```sh
pnpm check
pnpm check-types
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

The automated integration and E2E suites use PostgreSQL 18 from `compose.yaml`.
They are the only local commands that start Docker. Hosted service checks are a
separate canary and do not replace the deterministic test predicate.

## Architecture

The normative architecture is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The staged delivery plan is in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
