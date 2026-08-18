# SEO Discovery root

Standalone Eve root reserved for a later phase. Phase 0 exposes public Eve
health and an authenticated, payload-free dispatch acknowledgement. Production
session routes stay closed and the compiled task-kind allowlist is empty.

```sh
pnpm --filter agent-seo-discovery check-types
pnpm --filter agent-seo-discovery test
pnpm --filter agent-seo-discovery build
```
