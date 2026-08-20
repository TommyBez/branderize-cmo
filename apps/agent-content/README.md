# Content root

Standalone Eve root for the Content brief task. Its compiled allowlist contains
only `content.brief.v1`. Production Eve session routes stay closed; local
development uses Eve's `localDev()` policy.

```sh
pnpm --filter agent-content check-types
pnpm --filter agent-content test
pnpm --filter agent-content build
```
