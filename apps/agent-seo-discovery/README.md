# SEO Discovery root

Standalone Eve root for the SEO opportunity task. Its compiled allowlist
contains only `seo-discovery.opportunity.v1`. Production Eve session routes stay
closed; local development uses Eve's `localDev()` policy.

```sh
pnpm --filter agent-seo-discovery check-types
pnpm --filter agent-seo-discovery test
pnpm --filter agent-seo-discovery build
```
