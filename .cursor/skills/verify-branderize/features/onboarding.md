# Create a brand

Onboarding creates the organization, brand, website, and first goal, then opens the Intent register for that brand. This writes to the shared Neon development branch.

## Sub-features

- `onboard-open` shows the New brand form after a session with no brand.
- `onboard-create` persists organization, brand, website, and first goal.
- `onboard-continue` lands on the Intent register with the new goal visible.

## How to get to it (user POV)

- Sign in with an email that has no brand. `/` redirects to `/onboarding`.
- Open `http://127.0.0.1:3001/onboarding` while signed in.

## Driving it with verify-branderize

Preconditions:

- Fleet launch is healthy and `app.drive` is `ok`.
- The browser has a fresh local session (see sign-in).
- The page heading is `Start with the brand.`
- Choose unique slugs. Example: org `verify-org-<runId>`, brand `verify-brand-<runId>`.

- **Confirm form.** Labels `Organization name`, `Organization slug`, `Brand name`, `Brand slug`, `Website`, and `First goal` are present. The submit button is `Create brand and continue`.
- **Fill identity.**

```
page.getByLabel('Organization name').fill('Verify Org <runId>')
page.getByLabel('Organization slug').fill('verify-org-<runId>')
page.getByLabel('Brand name').fill('Verify Brand <runId>')
page.getByLabel('Brand slug').fill('verify-brand-<runId>')
page.getByLabel('Website').fill('https://verify-<runId>.example')
page.getByLabel('First goal').fill('Make the verify run produce a visible Intent.')
```

- **Submit.** Choose `Create brand and continue`. The button may read `Creating…` while pending.
- **Land on Intent.** The URL matches `/brands/<uuid>/intent`. The heading is `The result before the work.` The header aside shows `Verify Brand <runId>`. A link named `Make the verify run produce a visible Intent.` is in the register.
- **Proof.** Capture the Intent register, not the onboarding form. Re-open `/` and confirm it redirects back to the same brand Intent page, not `/onboarding`.

## Gotchas

- Website must be a public HTTPS URL. `http://` or a bare hostname fails the form.
- Slugs must match `[a-z0-9]+(?:-[a-z0-9]+)*`. Uppercase and spaces fail.
- This mutates the shared development database. Do not reuse a teammate's brand slug. Do not delete other people's brands during cleanup.
- If the user already has a brand, `/` skips onboarding. Use a new email.
- A first-run user with no organizations sees required org fields. A user who already belongs to an organization sees an `Organization` select plus `Create a new organization`.
