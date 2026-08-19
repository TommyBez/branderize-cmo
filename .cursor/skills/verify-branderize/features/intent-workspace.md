# Intent workspace

The console sidebar is the way a signed-in user moves between Intent, Brand Context, Work, and CMO for the current brand. Intent is the default workspace after onboarding.

## Sub-features

- `nav-intent` opens the Intent register.
- `nav-context` opens Brand Context.
- `nav-work` opens the Work ledger.
- `nav-cmo` opens the private CMO list.
- `nav-brand-switch` changes brand from the Brand select.

## How to get to it (user POV)

- After sign-in with a brand, `/` redirects to `/brands/<brandId>/intent`.
- Choose `Intent`, `Brand Context`, `Work`, or `CMO` in the sidebar navigation named `Primary`.
- Choose a brand in `Brand` and `Open the selected brand`.
- Choose the wordmark `Branderize CMO` to return to Intent.

## Driving it with verify-branderize

Preconditions:

- Fleet launch is healthy. A brand exists for the session (onboarding or an earlier verify brand you created).
- The shell wordmark `Branderize CMO` and a `Sign out` button are visible.

- **Intent.** Choose `Intent`. Run `page.getByRole('link', { exact: true, name: 'Intent' }).click()`. The heading is `The result before the work.` The eyebrow is `Intent register`.
- **Empty vs populated.** If there is no goal, the empty state heading is `There is no goal yet.` and a link `Go to the CMO →` is present. If a goal exists, it appears as a link whose name is the Intent statement.
- **Brand Context.** Choose `Brand Context`. The heading is `Sources, then proof.` Status copy is one of `The site is becoming Brand Context.`, `The site is not in Brand Context yet.`, `The brand has an active Brand Context.`, or `The claim can be resumed safely.`
- **Work.** Choose `Work`. The heading is `Work leaves a receipt.` Empty copy says Product Marketer tasks start only from one active Intent.
- **CMO.** Choose `CMO`. The heading is `Yours alone, inside the brand.` A privacy mark reads `Owner-private`.
- **Brand switch.** The combobox `Brand` shows the current brand. Changing it and choosing `Open the selected brand` loads that brand's Intent page.
- **Proof.** Capture Intent, then Brand Context, from the same session. Both screenshots must show the sidebar `Primary` navigation and the current brand name.

## Gotchas

- Navigation links include a decorative `01`–`04` prefix in the DOM. Use `{ exact: true, name: 'Intent' }` as the Phase 0 suite does.
- Pending shells show `Loading Intents.` and similar status text. Wait for the real heading before capturing.
- Brand Context `Start import` talks to Context.dev with the real local key. Do not start an import unless that is the feature under proof.
- Viewer role can read but cannot create conversations. Check the sidebar foot for the role before treating `Open` as available.
