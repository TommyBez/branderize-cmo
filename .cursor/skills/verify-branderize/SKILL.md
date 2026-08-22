---
name: verify-branderize
description: Drive the Branderize public site and product console the way a user does — landing, local email-OTP sign-in, onboarding, and the Intent / Brand Context / Work / CMO workspace. Use when proving a UI change, reproducing a user journey, or capturing screenshot and ARIA evidence from the real local apps.
---

# Verify Branderize

Branderize is a multi-tenant marketing work graph. A user touches two Next.js surfaces:

- Isolated public-site proof: `apps/web` at `http://127.0.0.1:3000`
- Local fleet: public site `http://web.localhost:1355` and console `http://app.localhost:1355/sign-in`

The isolated `web` launch does not start the console or agents. The fleet supervisor starts both Next surfaces and the seven Eve roots on Portless `http://*.localhost` names. Agents are headless. Do not treat them as a user surface. The Phase 0 Playwright suite under `tests/e2e` is a production-build CI gate with scripted providers and a Docker Postgres. It is not this skill's harness and it is not the local user path.

Read `features/README.md` before driving. Drive the mapped entry points, not an internal setter or a test-only auth helper.

## Launch

The isolated `web` launch uses port `3000`. The fleet uses Portless names and cannot share `http://web.localhost:1355` or `http://app.localhost:1355` with another session. If those origins already belong to a developer session, refuse to drive them. Do not attach to a shared instance.

From the repository root:

```sh
node .cursor/skills/verify-branderize/bin/launch.mjs web
```

Use `web` for public-site proofs. It starts only `apps/web` on `127.0.0.1:3000` with `NEXT_PUBLIC_APP_URL=http://localhost:3001`. Ready when `GET http://127.0.0.1:3000/` returns the heading `The AI CMO you can trust.`

```sh
node .cursor/skills/verify-branderize/bin/launch.mjs fleet
```

Use `fleet` for console proofs. It runs the repo supervisor `pnpm dev:local`, which requires `apps/app/.env.local` (Neon `DATABASE_URL`, `DIRECT_DATABASE_URL`, `BETTER_AUTH_SECRET`, `CMO_BRIDGE_SECRET`, `CRON_SECRET`, `DISPATCH_SECRET`, `CONTEXT_DEV_API_KEY`, `BLOB_STORE_ID`, `VERCEL_OIDC_TOKEN`). Ready when the landing heading is up and `GET http://app.localhost:1355/sign-in` returns `You can still see why something was made.` The supervisor enables local OTP bypass in the app process only. It does not write that marker to `.env.local`. Local sign-in accepts any non-empty code of up to six characters and sends no email.

`launch.mjs` writes `test-results/verify-branderize/run.json` and an evidence directory `test-results/verify-branderize/<runId>/`. If a required port is already listening, it exits without starting anything.

Teardown:

```sh
node .cursor/skills/verify-branderize/bin/cleanup.mjs
```

That kills only the recorded pid tree. It never deletes evidence.

## Doctor

Run this first whenever anything looks off:

```sh
node .cursor/skills/verify-branderize/bin/doctor.mjs
```

Exit `0` only when this skill started the web process and the landing heading is present. The JSON report also says whether the console is `ok`, `down`, or `refuse`. `refuse` means the port is occupied by a process this run did not start. Do not drive a `refuse` surface.

A worth-driving landing contains `The AI CMO you can trust.` A worth-driving sign-in page contains `You can still see why something was made.` and the button `Email me a code`. Fleet doctor also probes `/eve/v1/health` on the seven Portless agent origins.

## Drive

Use Playwright against the instance this skill launched. The locators below are the same accessible names the Phase 0 suite already asserts. Prefer roles and labels over CSS and coordinates.

```sh
node .cursor/skills/verify-branderize/bin/capture.mjs \
  --url http://127.0.0.1:3000/ \
  --expect-heading "The AI CMO you can trust." \
  --click-role link --click-name "How it works" \
  --out test-results/verify-branderize/<runId>/landing
```

Interactive driving (Playwright or the Cursor browser) must use these handles:

| Surface | Handle |
| --- | --- |
| Landing CTA | `getByRole('link', { name: 'Open the Branderize app and sign in with email' })` |
| Landing header sign-in | `getByRole('link', { name: 'Sign in' })` |
| Landing sections | `How it works`, `Why trust it`, `Questions` in `navigation` named `Primary` |
| Sign-in email | `getByRole('textbox', { name: 'Email' })` then `getByRole('button', { name: 'Email me a code' })` |
| Sign-in code | `getByRole('textbox', { name: 'Sign-in code' })` then `getByRole('button', { name: 'Sign in' })` |
| Onboarding | labels `Organization name`, `Organization slug`, `Brand name`, `Brand slug`, `Website`, `First goal`; button `Create brand and continue` |
| Console nav | `navigation` named `Primary`: `Intent`, `Brand Context`, `Work`, `CMO` |
| Brand switcher | `getByLabel('Brand')` and `getByRole('button', { name: 'Open the selected brand' })` |
| Sign out | `getByRole('button', { name: 'Sign out' })` |
| New CMO chat | `getByLabel('New conversation')` and `getByRole('button', { name: 'Open' })` |
| CMO composer | `getByLabel('Message to the CMO')` and `getByRole('button', { name: 'Send' })` |

After local OTP, `/` redirects to `/onboarding` when the user has no brand, otherwise `/brands/<brandId>/intent`.

Do not use `tests/e2e/support/auth.ts` (`signUpEmail` + session cookie). That is the CI fixture, not the user path. Do not import `scripted-providers.mjs` into a local verify run.

## Evidence

Proof lives under `test-results/verify-branderize/<runId>/`. Cleanup must not remove it.

Standards:

- Exercise the real user path (landing link, email OTP, onboarding form, sidebar nav).
- Capture the action and the resulting state: screenshot plus `main` ARIA snapshot, not only the final URL.
- For mutations, prove a second user-facing view. Creating a brand is not done until the Intent register heading `The result before the work.` shows the new brand name in the header aside and the new goal as a link.
- Side effects for onboarding live in the shared Neon development branch. Record the unique `verify-*` slug and email used. Do not claim isolation you do not have.
- `pnpm test:e2e` proves the production-build contract with scripted Context.dev / Blob / Gateway. It does not prove the local `pnpm dev:local` OTP path.

## Cleanup

```sh
node .cursor/skills/verify-branderize/bin/cleanup.mjs
```

Kills the pid in `run.json` only. Never `pkill next` or `pkill eve`. Leave `test-results/verify-branderize/<runId>/` in place. Do not delete brands or users from Neon unless the feature file says to; there is no disposable data directory.

## Helpers

All helpers are executable Node scripts. Invoke them from the repository root as shown above.

| Script | Purpose |
| --- | --- |
| `bin/launch.mjs web\|fleet` | Start an isolated verify instance and write `run.json` |
| `bin/doctor.mjs` | Read-only: is this instance ours and worth driving? |
| `bin/capture.mjs` | Playwright screenshot, title, and `main` ARIA snapshot |
| `bin/cleanup.mjs` | Stop the recorded pid tree; keep evidence |
