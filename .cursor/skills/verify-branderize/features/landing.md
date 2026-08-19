# Public landing

The public site tells a visitor what Branderize is, how it works, and how to enter the app with email. Nothing on this page requires a session.

## Sub-features

- `landing-load` shows the product heading and Early access eyebrow.
- `landing-nav` jumps to How it works, Why trust it, and Questions.
- `landing-cta` offers the accessible sign-in call to action that points at the console origin.
- `landing-skip` exposes Skip to content.

## How to get to it (user POV)

- Open `http://127.0.0.1:3000/` or `http://localhost:3000/`.
- Choose `How it works`, `Why trust it`, or `Questions` in the primary navigation.
- Choose `Sign in` in the header, or `Sign in with email` in the hero or closing section.

## Driving it with verify-branderize

Preconditions:

- `node .cursor/skills/verify-branderize/bin/launch.mjs web` (or `fleet`) has started.
- `bin/doctor.mjs` reports `web.drive` as `ok`.
- The browser is not already on a console origin.

- **Open landing.** Go to `http://127.0.0.1:3000/`. The document title is `Branderize | The AI CMO you can trust` and the heading `The AI CMO you can trust.` is visible.
- **Skip link.** The link `Skip to content` is present. Activating it moves to `#content`.
- **Primary nav.** Choose `How it works`. Run `page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'How it works' }).click()`. The heading `Write the goal. Keep it on the work.` is in view.
- **Trust section.** Choose `Why trust it`. The heading `The goal stays on the work.` is in view.
- **Questions.** Choose `Questions`. The heading `What people ask first.` is in view and the question `Is this just another AI marketing tool?` is listed.
- **Hero CTA.** The link named `Open the Branderize app and sign in with email` is visible in the hero. Its `href` is the console origin (`http://localhost:3001` when launched by this skill).
- **Header sign-in.** The header also has a link named `Sign in` to the same origin.
- **Proof.** Capture the landing and the How it works jump:

```sh
node .cursor/skills/verify-branderize/bin/capture.mjs \
  --url http://127.0.0.1:3000/ \
  --expect-heading "The AI CMO you can trust." \
  --click-role link --click-name "How it works" \
  --out test-results/verify-branderize/<runId>/landing
```

The ARIA snapshot names Branderize, the product heading, and the How it works section. The screenshot shows the wordmark `Branderize` and the method heading.

## Gotchas

- `http://localhost:3000` and `http://127.0.0.1:3000` are both valid once Next is bound; doctor and capture use `127.0.0.1`.
- The hero CTA accessible name is `Open the Branderize app and sign in with email`, not the visible text `Sign in with email` alone.
- Clicking the CTA leaves the public site. That is the sign-in feature, not landing proof.
- A `refuse` on port 3000 means a foreign `next dev` is already bound. Do not capture it.
