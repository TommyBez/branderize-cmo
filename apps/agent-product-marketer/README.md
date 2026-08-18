# Product Marketer root

Standalone Eve root for the Phase 0 Product Marketer task. Its compiled
allowlist contains only `product-marketer.brand-context.v1`. Production Eve
session routes stay closed; local development uses Eve's `localDev()` policy.

The framework exposes public health at `GET /eve/v1/health`. The internal
dispatcher accepts only an empty `POST /internal/dispatch` authenticated with
`Authorization: Bearer $DISPATCH_SECRET`; it currently acknowledges the poke
without claiming work.

Run commands from the workspace root:

```sh
pnpm --filter agent-product-marketer check-types
pnpm --filter agent-product-marketer test
pnpm --filter agent-product-marketer build
pnpm --filter agent-product-marketer dev
```
