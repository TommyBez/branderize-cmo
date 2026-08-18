# Branderize CMO

Branderize is a multi-tenant marketing work graph with a private CMO and six specialist agents.

## Requirements

- Node 24.x
- Corepack
- pnpm 11.22.0
- Docker for PostgreSQL integration tests

This repository uses pnpm 11.22.0 exclusively.

## Setup

```sh
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install --frozen-lockfile
```

## Development

```sh
pnpm dev
```

The public web app runs on port 3000. The authenticated console runs on port 3001.

## Verification

```sh
pnpm check
pnpm check-types
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

The integration suite uses PostgreSQL 17 from `compose.yaml`. Hosted service checks are a separate canary and do not replace the local predicate.

## Architecture

The normative architecture is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The staged delivery plan is in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
