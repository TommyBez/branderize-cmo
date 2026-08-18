import { parseClientEnvironment } from '@repo/env/client'

export const instant = true

const { NEXT_PUBLIC_APP_URL: APP_URL } = parseClientEnvironment(process.env)

const ArrowIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20">
    <path d="M4 10h11M11 5l5 5-5 5" />
  </svg>
)

const LockIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20">
    <rect height="9" rx="1" width="12" x="4" y="8" />
    <path d="M7 8V6a3 3 0 0 1 6 0v2" />
  </svg>
)

const SourceIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20">
    <circle cx="5" cy="5" r="2" />
    <circle cx="15" cy="10" r="2" />
    <circle cx="5" cy="15" r="2" />
    <path d="m7 6 6 3M7 14l6-3" />
  </svg>
)

const AppLink = ({ className }: { className: string }) => (
  <a
    aria-label="Open the Branderize app and sign in with email"
    className={className}
    href={APP_URL}
  >
    <LockIcon />
    <span>Sign in with email</span>
    <ArrowIcon />
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
          <a href="#method">The method</a>
          <a href="#shared">What’s shared</a>
        </nav>

        <a className="header-entry" href={APP_URL}>
          Sign in
          <ArrowIcon />
        </a>
      </header>

      <section className="hero" id="content">
        <div className="hero-copy">
          <p className="eyebrow reveal reveal-one">
            Know the goal before anyone starts
          </p>
          <h1 className="reveal reveal-two">
            A clear direction.
            <br />
            <em>Before the work.</em>
          </h1>
          <p className="hero-lede reveal reveal-three">
            Write what the brand is trying to do. Add the website. Talk to your
            CMO without the rest of the team in the room.
          </p>

          <div className="hero-actions reveal reveal-four">
            <AppLink className="primary-cta" />
            <p>Opens the Branderize app.</p>
          </div>

          <dl className="hero-facts reveal reveal-five">
            <div>
              <dt>01</dt>
              <dd>Write the goal</dd>
            </div>
            <div>
              <dt>02</dt>
              <dd>Add the website</dd>
            </div>
            <div>
              <dt>03</dt>
              <dd>Private chat</dd>
            </div>
            <div>
              <dt>04</dt>
              <dd>See why it was made</dd>
            </div>
          </dl>
        </div>

        <div className="hero-proof reveal reveal-three">
          <div className="proof-caption">
            <span>What it looks like</span>
            <span className="status-dot">Ready</span>
          </div>

          <div className="intent-sheet">
            <div className="sheet-heading">
              <span>Current goal</span>
              <span>First version</span>
            </div>
            <p>Make the positioning clear to the sales team.</p>
            <div className="sheet-meta">
              <span>Written by you</span>
              <span>Visible to the team</span>
            </div>
          </div>

          <div className="context-sheet">
            <div className="context-source">
              <SourceIcon />
              <div>
                <span>Website</span>
                <strong>Added</strong>
              </div>
            </div>
            <p>
              The team can open the site from here. You can still see which site
              it was.
            </p>
            <div className="source-chain">
              <span>You</span>
              <i aria-hidden="true" />
              <span>Added</span>
              <i aria-hidden="true" />
              <span>The site</span>
            </div>
          </div>

          <div className="private-note">
            <LockIcon />
            <div>
              <span>CMO</span>
              <strong>Private conversation</strong>
            </div>
            <span className="owner-label">Only you</span>
          </div>
        </div>
      </section>

      <section aria-label="Product principles" className="principle-strip">
        <p>Share the work.</p>
        <span aria-hidden="true" />
        <p>Keep the conversation private.</p>
        <span aria-hidden="true" />
        <p>You can always see why something was made.</p>
      </section>

      <section className="method-section" id="method">
        <div className="section-intro">
          <p className="eyebrow">The method</p>
          <h2>Marketing starts with the goal, not the file you hand over.</h2>
        </div>

        <p className="method-lede">
          A brief loses its why the moment it leaves your hands. Here, you can
          still see the goal behind anything that got made.
        </p>

        <ol className="method-list">
          <li>
            <span>01</span>
            <div>
              <h3>Write the goal</h3>
              <p>What you want, in your words.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Add the website</h3>
              <p>The team can open it later.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Talk to the CMO</h3>
              <p>That chat stays yours.</p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>See why it exists</h3>
              <p>Open the work. The goal is right there.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="boundary-section" id="shared">
        <div className="boundary-heading">
          <p className="eyebrow">What’s shared</p>
          <h2>Shared where it helps. Private where it matters.</h2>
        </div>

        <div className="boundary-ledger">
          <article>
            <span className="ledger-number">A</span>
            <p className="ledger-kicker">On the team</p>
            <h3>The goal and the work</h3>
            <p>
              Open something that got made. The goal it came from is right
              there.
            </p>
          </article>
          <article className="private-ledger">
            <span className="ledger-number">B</span>
            <p className="ledger-kicker">Yours</p>
            <h3>The chat with the CMO</h3>
            <p>
              Nobody else can read it. Only what you decide to keep becomes
              visible.
            </p>
          </article>
        </div>
      </section>

      <section className="closing-section">
        <div>
          <p className="eyebrow">First step</p>
          <h2>Bring the brand in.</h2>
        </div>
        <div className="closing-action">
          <p>Write the first goal. Add the website.</p>
          <AppLink className="primary-cta primary-cta-light" />
        </div>
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
        <p className="footer-tagline">The goal is shared. The chat is not.</p>
        <p className="footer-phase">Early access</p>
      </footer>
    </main>
  )
}
