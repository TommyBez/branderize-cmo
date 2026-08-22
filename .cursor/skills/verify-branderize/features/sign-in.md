# Sign in with email

Sign in asks for an email, then a one-time code, and drops the user into onboarding or their first brand. Locally the runner does not send email; any non-empty code of up to six characters works.

## Sub-features

- `signin-open` shows the unauthenticated console form.
- `signin-request` accepts an email and switches to the code field.
- `signin-verify` completes local OTP and leaves `/sign-in`.
- `signin-reset` returns to the email field via Use a different email.

## How to get to it (user POV)

- Open `http://app.localhost:1355/sign-in` directly.
- From the public site, choose `Sign in with email` or header `Sign in`.
- After sign-out, the console returns to `/sign-in`.

## Driving it with verify-branderize

Preconditions:

- `node .cursor/skills/verify-branderize/bin/launch.mjs fleet` has started.
- `bin/doctor.mjs` reports `app.drive` as `ok`.
- Use a unique address `verify-<runId>@example.test`.

- **Open sign-in.** Go to `http://app.localhost:1355/sign-in`. The heading `You can still see why something was made.` is visible and the button `Email me a code` is enabled.
- **Enter email.** Fill `Email` with `verify-<runId>@example.test`. Run `page.getByRole('textbox', { name: 'Email' }).fill('verify-<runId>@example.test')`.
- **Request code.** Choose `Email me a code`. Run `page.getByRole('button', { name: 'Email me a code' }).click()`. A status says `Local development for verify-<runId>@example.test: enter any code.` The `Sign-in code` textbox is focused. Help text says `The local runner does not send email.`
- **Wrong empty code.** Submit without a code. The native required check blocks send, or an alert `That code didn’t work. Check it and try again.` appears after a failed verify.
- **Verify.** Fill `Sign-in code` with `123456` and choose `Sign in`. Run `page.getByRole('textbox', { name: 'Sign-in code' }).fill('123456')` and `page.getByRole('button', { name: 'Sign in' }).click()`. The location leaves `/sign-in` for `/onboarding` or `/brands/<id>/intent`.
- **Different email.** Before verify, `Use a different email` returns the `Email` field.
- **Proof.** Capture the awaiting-code state before submit, then the post-login heading. The first artifact must show the local-development status for the exact email. The second must not still be the sign-in form.

## Gotchas

- Hosted preview/production send a real Resend OTP. This skill only proves the local bypass. Do not expect an inbox.
- A session already in the browser redirects away from `/sign-in`. Use a fresh context, or choose `Sign out`.
- `createAuthenticatedBrowser` in `tests/e2e/support/auth.ts` is not this feature. Cookie injection is not a user path.
- The code field allows at most six characters. A longer value is truncated.
- Doctor `app.drive: refuse` means someone else's console is on 3001. Stop. Do not sign in there.
