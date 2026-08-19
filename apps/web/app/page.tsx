import { parseClientEnvironment } from '@repo/env/client'

export const instant = true

const { NEXT_PUBLIC_APP_URL: APP_URL } = parseClientEnvironment(process.env)

const AppLink = ({ className }: { className: string }) => (
  <a
    aria-label="Open the Branderize app and sign in with email"
    className={className}
    href={APP_URL}
  >
    Sign in with email
  </a>
)

export default function Home() {
  return (
    <main id="top">
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <div aria-hidden="true" className="page-grain" />

      <header className="site-header">
        <a
          aria-label="Branderize, back to the top"
          className="brand"
          href="#top"
        >
          <span aria-hidden="true" className="brand-mark">
            B/
          </span>
          <span>Branderize</span>
        </a>

        <nav aria-label="Primary" className="primary-nav">
          <a href="#how">How it works</a>
          <a href="#trust">Why trust it</a>
        </nav>

        <a className="header-entry" href={APP_URL}>
          Sign in
        </a>
      </header>

      <section className="hero" id="content">
        <div className="hero-copy">
          <h1>The AI CMO you can trust.</h1>
          <p className="hero-lede">
            Write the goal. Add the website. A CMO and specialists work against
            it. You approve anything public.
          </p>

          <div className="hero-actions">
            <AppLink className="primary-cta" />
          </div>
        </div>

        <aside aria-label="Example goal" className="hero-proof">
          <p className="proof-label">Current goal</p>
          <p className="proof-goal">
            Make the positioning clear to the sales team.
          </p>
          <p className="proof-meta">Written by you. Visible to the team.</p>
        </aside>
      </section>

      <section className="method-section" id="how">
        <div className="section-intro">
          <h2>Marketing starts with the goal, not the file you hand over.</h2>
          <p className="method-lede">
            A brief loses its why the moment it leaves your hands. Here, the
            goal stays on whatever gets made.
          </p>
        </div>

        <ol className="method-list">
          <li>
            <h3>Write the goal</h3>
            <p>Name the outcome the brand must get.</p>
          </li>
          <li>
            <h3>Add the website</h3>
            <p>The team works from the real site, not a blank page.</p>
          </li>
          <li>
            <h3>The CMO takes it</h3>
            <p>Specialists execute against that goal.</p>
          </li>
          <li>
            <h3>You keep the last word</h3>
            <p>Publish, send, and spend wait for you.</p>
          </li>
        </ol>
      </section>

      <section className="boundary-section" id="trust">
        <h2>The goal stays on the work.</h2>

        <div className="boundary-ledger">
          <article>
            <h3>You can still see why</h3>
            <p>
              Open something that got made. The goal it came from is right
              there.
            </p>
          </article>
          <article>
            <h3>You have the last word</h3>
            <p>
              Preparation can be automatic. Publish, send, and spend wait for a
              person.
            </p>
          </article>
        </div>
      </section>

      <section className="closing-section">
        <div>
          <h2>Bring the brand in.</h2>
          <p>Write the first goal. Add the website.</p>
        </div>
        <AppLink className="primary-cta" />
      </section>

      <footer>
        <a
          aria-label="Branderize, back to the top"
          className="brand"
          href="#top"
        >
          <span aria-hidden="true" className="brand-mark">
            B/
          </span>
          <span>Branderize</span>
        </a>
        <p className="footer-tagline">The AI CMO you can trust.</p>
        <p className="footer-phase">Early access</p>
      </footer>
    </main>
  )
}
