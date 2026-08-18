# Growth root

Standalone Eve root reserved for a later phase. Phase 0 exposes public Eve
health and an authenticated, payload-free dispatch acknowledgement. Production
session routes stay closed and the compiled task-kind allowlist is empty.

```sh
pnpm --filter agent-growth check-types
pnpm --filter agent-growth test
pnpm --filter agent-growth build
```
