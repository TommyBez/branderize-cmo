# Branderize web

The public landing and sign-in surface runs on port 3000.

Hosted preview and production resolve the console origin from Vercel Related
Projects (`branderize-cmo-app`). Local `pnpm dev:local` and E2E still set
`NEXT_PUBLIC_APP_URL` to the exact HTTP(S) origin of `apps/app`. Missing,
malformed, credentialed, or path-bearing values fail closed instead of sending a
hosted call to action to localhost.

From the repository root:

```sh
pnpm --filter web dev
```

Use pnpm 11.22.0 for every local and CI command.
