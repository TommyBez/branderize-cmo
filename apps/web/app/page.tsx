import { parseClientEnvironment } from '@repo/env/client'

export const instant = true

const { NEXT_PUBLIC_APP_URL: APP_URL } = parseClientEnvironment(process.env)

const METHOD_STEPS = [
  {
    body: 'Name the outcome the brand must get.',
    title: 'Write the goal',
  },
  {
    body: 'The team works from the real site, not a blank page.',
    title: 'Add the website',
  },
  {
    body: 'Specialists execute against that goal.',
    title: 'The CMO takes it',
  },
  {
    body: 'Publish, send, and spend wait for you.',
    title: 'You keep the last word',
  },
] as const

const BENEFITS = [
  {
    body: 'Open something that got made. The goal it came from is right there.',
    title: 'The why never falls off',
  },
  {
    body: 'Preparation can be automatic. Publish, send, and spend wait for a person.',
    title: 'Public work waits for you',
  },
  {
    body: 'The team works from the real website. If the source fails, nothing is invented in its place.',
    title: 'The site is the source',
  },
] as const

const QUESTIONS = [
  {
    answer:
      'Chat is not the source of truth. The goal, brand context, and work are. Open anything that got made — the goal is still there.',
    question: 'Is this just another AI marketing tool?',
  },
  {
    answer:
      'No. Preparation can be automatic. Publish, send, activate, and spend wait for a person.',
    question: 'Will it post or spend without me?',
  },
  {
    answer: 'Write the first goal. Add the website. That is enough to begin.',
    question: 'We’re early. Do we need a marketing team?',
  },
  {
    answer: 'Early access. Public pricing is not published yet.',
    question: 'What does it cost?',
  },
  {
    answer: 'A brand name, a first goal, and a public website.',
    question: 'What do I need to start?',
  },
  {
    answer: 'The team sees the goal and the work. Sign in with email to begin.',
    question: 'Who sees the work?',
  },
] as const

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
          <span translate="no">Branderize</span>
        </a>

        <nav aria-label="Primary" className="primary-nav">
          <a href="#how">How it works</a>
          <a href="#trust">Why trust it</a>
          <a href="#questions">Questions</a>
        </nav>

        <a className="header-entry" href={APP_URL}>
          Sign in
        </a>
      </header>

      <section className="hero" id="content">
        <div className="hero-copy">
          <p className="eyebrow reveal reveal-1">Early access</p>
          <h1 className="reveal reveal-2">The AI CMO you can trust.</h1>
          <p className="hero-lede reveal reveal-3">
            Write the goal. Add the website. A CMO and specialists work against
            it. You approve anything public.
          </p>

          <div className="hero-actions reveal reveal-4">
            <AppLink className="primary-cta" />
            <p className="hero-risk">
              Sign in with email. No password. Nothing public without you.
            </p>
          </div>
        </div>

        <aside aria-label="Example goal" className="hero-proof reveal reveal-5">
          <p className="proof-label">Current goal</p>
          <p className="proof-goal">
            Make the positioning clear to the sales team.
          </p>
          <p className="proof-meta">Written by you. Visible to the team.</p>
        </aside>
      </section>

      <section className="benefit-section" id="why">
        <div className="section-intro">
          <p className="eyebrow">Why it holds</p>
          <h2>Marketing starts with the goal, not the file you hand over.</h2>
          <p className="method-lede">
            A brief loses its why the moment it leaves your hands. Here, the
            goal stays on whatever gets made.
          </p>
        </div>

        <ol className="benefit-list">
          {BENEFITS.map((benefit) => (
            <li key={benefit.title}>
              <h3>{benefit.title}</h3>
              <p>{benefit.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="method-section" id="how">
        <div className="section-intro">
          <p className="eyebrow">How it works</p>
          <h2>Write the goal. Keep it on the work.</h2>
        </div>

        <ol className="method-list">
          {METHOD_STEPS.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="boundary-section" id="trust">
        <div className="section-intro">
          <p className="eyebrow">Why trust it</p>
          <h2>The goal stays on the work.</h2>
        </div>

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

      <section className="question-section" id="questions">
        <div className="section-intro">
          <p className="eyebrow">Questions</p>
          <h2>What people ask first.</h2>
        </div>

        <dl className="question-list">
          {QUESTIONS.map((item) => (
            <div key={item.question}>
              <dt>{item.question}</dt>
              <dd>{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="closing-section">
        <div>
          <p className="eyebrow">Begin</p>
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
          <span translate="no">Branderize</span>
        </a>
        <p className="footer-tagline">The AI CMO you can trust.</p>
        <p className="footer-phase">Early access</p>
      </footer>
    </main>
  )
}
