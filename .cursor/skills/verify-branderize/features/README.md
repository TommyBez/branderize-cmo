# Branderize verification map

This directory is the maintained source for verifying user-facing Branderize behavior. Read the index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-branderize/bin/launch.mjs web` for public-site features, or `fleet` for console features.
- Run `node .cursor/skills/verify-branderize/bin/doctor.mjs` and require `web.drive` (and `app.drive` for console) to be `ok`, not `refuse`.
- Never drive a process that this skill did not start. Ports 3000, 3001, and 2000-2006 are shared and cannot host a second fleet.
- Local console sign-in uses email plus any non-empty code of up to six characters. No email is sent.
- Onboarding writes to the shared Neon development branch. Use unique `verify-<runId>` slugs and a disposable `verify-<runId>@example.test` email.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position.
- Treat every command as literal. Keep quoted names unchanged.
- Capture with `bin/capture.mjs`. Interactive clicks use the Playwright locators in each feature file.
- Do not use the E2E `createAuthenticatedBrowser` helper or scripted providers.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot of `main` and a full-page screenshot that shows the Branderize wordmark or landing heading.
- Mutation proof includes a second user-facing view of the stored value (Intent list, conversation list, or Brand Context status).
- Record the feature ID and entry point used with every artifact under `test-results/verify-branderize/<runId>/`.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify-branderize` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Public landing](./landing.md) covers the marketing site, primary navigation, and the sign-in call to action.
- [Sign in with email](./sign-in.md) covers the local OTP path into the console.
- [Create a brand](./onboarding.md) covers first-run onboarding to an Intent register.
- [Intent workspace](./intent-workspace.md) covers the console sidebar and the Intent register.
- [Private CMO](./cmo-conversation.md) covers opening an owner-private conversation.
