type NavigationPendingVariant = 'detail' | 'list'

const PendingList = () => (
  <div aria-hidden="true" className="navigation-pending__list">
    <span />
    <span />
    <span />
  </div>
)

const PendingDetail = () => (
  <div aria-hidden="true" className="navigation-pending__detail">
    <span className="navigation-pending__line navigation-pending__line--long" />
    <span className="navigation-pending__line navigation-pending__line--medium" />
    <div className="navigation-pending__panel" />
  </div>
)

export const NavigationPending = ({
  eyebrow,
  status,
  title,
  variant = 'list',
}: {
  readonly eyebrow: string
  readonly status: string
  readonly title: string
  readonly variant?: NavigationPendingVariant
}) => (
  <div aria-busy="true" className="navigation-pending">
    <p className="sr-only" role="status">
      {status}
    </p>
    <header className="page-header">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
    </header>
    {variant === 'detail' ? <PendingDetail /> : <PendingList />}
  </div>
)

export const AppShellPending = ({
  children,
}: {
  readonly children: React.ReactNode
}) => (
  <div aria-busy="true" className="app-frame app-frame--pending">
    <aside aria-hidden="true" className="sidebar sidebar--pending">
      <span className="wordmark">
        Branderize<span>CMO</span>
      </span>
      <div className="navigation-pending__brand" />
      <div className="navigation-pending__nav">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="navigation-pending__identity" />
    </aside>
    <main className="workspace">{children}</main>
  </div>
)

export const StandaloneNavigationPending = ({
  eyebrow,
  status,
  title,
}: {
  readonly eyebrow: string
  readonly status: string
  readonly title: string
}) => (
  <main
    aria-busy="true"
    className="standalone-navigation-pending navigation-pending"
  >
    <p className="sr-only" role="status">
      {status}
    </p>
    <span className="wordmark wordmark--dark">
      Branderize<span>CMO</span>
    </span>
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <PendingDetail />
    </div>
  </main>
)
