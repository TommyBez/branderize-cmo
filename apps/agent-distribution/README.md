# Distribution root

Standalone Eve root for the channel plan task. Its compiled allowlist contains
only `distribution.channel-plan.v1`. Production Eve session routes stay closed;
local development uses Eve's `localDev()` policy.

```sh
pnpm --filter agent-distribution check-types
pnpm --filter agent-distribution test
pnpm --filter agent-distribution build
```
