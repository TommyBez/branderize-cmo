# CMO root

Standalone Eve root for private CMO conversations. Production conversation
traffic requires the short-lived HS256 bridge token minted by `apps/app`; the
root maps its subject to an Eve user principal and keeps role authorization in
the application.

The framework exposes public health at `GET /eve/v1/health`. The internal
dispatcher accepts only an empty `POST /internal/dispatch` authenticated with
`Authorization: Bearer $DISPATCH_SECRET`; it currently acknowledges the poke
without claiming work.

`request_specialist_work` reads the four specialist fleet URLs
(`AGENT_PRODUCT_MARKETER_URL`, `AGENT_CONTENT_URL`,
`AGENT_DISTRIBUTION_URL`, and `AGENT_SEO_DISCOVERY_URL`). After a `created`
receipt commits, the tool sends one empty `POST /internal/dispatch` with
`DISPATCH_SECRET` to the matching specialist. A timeout, transport failure,
or non-`202` response leaves the receipt valid for the minute Cron to recover.

Run commands from the workspace root:

```sh
pnpm --filter agent-cmo check-types
pnpm --filter agent-cmo test
pnpm --filter agent-cmo build
pnpm --filter agent-cmo dev
```
