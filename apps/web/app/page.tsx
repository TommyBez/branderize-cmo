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
    aria-label="Apri l'app Branderize e accedi via email"
    className={className}
    href={APP_URL}
  >
    <LockIcon />
    <span>Accedi via email</span>
    <ArrowIcon />
  </a>
)

export default function Home() {
  return (
    <main id="top">
      <a className="skip-link" href="#contenuto">
        Vai al contenuto
      </a>

      <div aria-hidden="true" className="page-grain" />

      <header className="site-header">
        <a
          aria-label="Branderize, torna all'inizio"
          className="brand"
          href="#top"
        >
          <span aria-hidden="true" className="brand-mark">
            B/
          </span>
          <span>Branderize</span>
        </a>

        <nav aria-label="Navigazione principale" className="primary-nav">
          <a href="#metodo">Il metodo</a>
          <a href="#confini">Come funziona</a>
        </nav>

        <a className="header-entry" href={APP_URL}>
          Accedi
          <ArrowIcon />
        </a>
      </header>

      <section className="hero" id="contenuto">
        <div className="hero-copy">
          <p className="eyebrow reveal reveal-one">
            Sistema operativo per il marketing
          </p>
          <h1 className="reveal reveal-two">
            Una direzione chiara.
            <br />
            <em>Prima del lavoro.</em>
          </h1>
          <p className="hero-lede reveal reveal-three">
            Branderize parte dall'Intent del brand, importa un contesto
            verificabile e conserva la provenienza di ciò che viene prodotto. Il
            tuo CMO resta una conversazione privata.
          </p>

          <div className="hero-actions reveal reveal-four">
            <AppLink className="primary-cta" />
            <p>L'accesso avviene nell'app Branderize.</p>
          </div>

          <dl className="hero-facts reveal reveal-five">
            <div>
              <dt>01</dt>
              <dd>Intent dichiarato</dd>
            </div>
            <div>
              <dt>02</dt>
              <dd>Contesto importato</dd>
            </div>
            <div>
              <dt>03</dt>
              <dd>CMO solo tuo</dd>
            </div>
            <div>
              <dt>04</dt>
              <dd>Origine tracciata</dd>
            </div>
          </dl>
        </div>

        <div className="hero-proof reveal reveal-three">
          <div className="proof-caption">
            <span>Esempio di stato</span>
            <span className="status-dot">Brand inizializzato</span>
          </div>

          <div className="intent-sheet">
            <div className="sheet-heading">
              <span>Intent attivo</span>
              <span>rev. 1</span>
            </div>
            <p>Rendere il posizionamento comprensibile ai team commerciali.</p>
            <div className="sheet-meta">
              <span>Dichiarato da una persona</span>
              <span>Stato canonico</span>
            </div>
          </div>

          <div className="context-sheet">
            <div className="context-source">
              <SourceIcon />
              <div>
                <span>Brand Context</span>
                <strong>Import completato</strong>
              </div>
            </div>
            <p>
              Sito e materiali del brand diventano un oggetto consultabile con
              fonte e impronta verificabile.
            </p>
            <div className="source-chain">
              <span>Actor</span>
              <i aria-hidden="true" />
              <span>Action</span>
              <i aria-hidden="true" />
              <span>Object</span>
            </div>
          </div>

          <div className="private-note">
            <LockIcon />
            <div>
              <span>CMO</span>
              <strong>Conversazione privata</strong>
            </div>
            <span className="owner-label">Solo tu</span>
          </div>
        </div>
      </section>

      <section aria-label="Principi del prodotto" className="principle-strip">
        <p>Condividi il lavoro.</p>
        <span aria-hidden="true" />
        <p>Proteggi la conversazione.</p>
        <span aria-hidden="true" />
        <p>Risalire alla fonte deve essere semplice.</p>
      </section>

      <section className="method-section" id="metodo">
        <div className="section-intro">
          <p className="eyebrow">Il metodo</p>
          <h2>Il marketing comincia da ciò che il brand intende fare.</h2>
        </div>

        <p className="method-lede">
          Un brief isolato perde il suo perché appena passa di mano. Branderize
          lega invece ogni risultato a un Intent, all'azione che l'ha generato e
          all'attore responsabile.
        </p>

        <ol className="method-list">
          <li>
            <span>01</span>
            <div>
              <h3>Dichiara l'Intent</h3>
              <p>Scrivi l'obiettivo umano che autorizza il lavoro del brand.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Importa il contesto</h3>
              <p>
                Il sito diventa un Brand Context con fonte, file e impronta.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Parla con il CMO</h3>
              <p>
                La conversazione appartiene al suo proprietario, anche dentro il
                team.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Segui la provenienza</h3>
              <p>
                Ogni oggetto canonico indica chi ha agito e per quale Intent.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="boundary-section" id="confini">
        <div className="boundary-heading">
          <p className="eyebrow">Confini chiari</p>
          <h2>Condiviso quando serve. Privato quando conta.</h2>
        </div>

        <div className="boundary-ledger">
          <article>
            <span className="ledger-number">A</span>
            <p className="ledger-kicker">Nell'organizzazione</p>
            <h3>Intent, Object e Action</h3>
            <p>
              Il team consulta lo stesso stato canonico e può risalire dalla
              consegna alla sua origine.
            </p>
          </article>
          <article className="private-ledger">
            <span className="ledger-number">B</span>
            <p className="ledger-kicker">Del proprietario</p>
            <h3>La conversazione con il CMO</h3>
            <p>
              Il dialogo non diventa automaticamente memoria condivisa. Solo le
              azioni esplicite entrano nello stato del brand.
            </p>
          </article>
        </div>
      </section>

      <section className="closing-section">
        <div>
          <p className="eyebrow">Il primo passo</p>
          <h2>Porta il brand dentro il sistema.</h2>
        </div>
        <div className="closing-action">
          <p>Dichiara il primo Intent e importa il contesto dal sito.</p>
          <AppLink className="primary-cta primary-cta-light" />
        </div>
      </section>

      <footer>
        <a
          aria-label="Branderize, torna all'inizio"
          className="brand"
          href="#top"
        >
          <span aria-hidden="true" className="brand-mark">
            B/
          </span>
          <span>Branderize</span>
        </a>
        <p className="footer-tagline">
          Stato canonico per il lavoro di marketing.
        </p>
        <p className="footer-phase">Phase 0</p>
      </footer>
    </main>
  )
}
