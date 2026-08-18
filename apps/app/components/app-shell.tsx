import Link from 'next/link'
import { switchBrandAction } from '@/lib/actions'
import type { BrandNavigationItem, BrandPageContext } from '@/lib/dal'

import { SignOutButton } from './sign-out-button'

const navigation = [
  { label: 'Intent', path: 'intent' },
  { label: 'Brand Context', path: 'context' },
  { label: 'Work', path: 'work' },
  { label: 'CMO', path: 'cmo' },
] as const

const BrandOption = ({ brand }: { readonly brand: BrandNavigationItem }) => (
  <option value={brand.id}>{brand.name}</option>
)

export const AppShell = ({
  children,
  context,
}: {
  readonly children: React.ReactNode
  readonly context: BrandPageContext
}) => (
  <div className="app-frame">
    <aside className="sidebar">
      <Link className="wordmark" href={`/brands/${context.brand.id}/intent`}>
        Branderize<span>CMO</span>
      </Link>

      <form action={switchBrandAction} className="brand-switcher">
        <label htmlFor="brand-switcher">Brand</label>
        <div className="brand-switcher__control">
          <select
            defaultValue={context.brand.id}
            id="brand-switcher"
            name="brandId"
          >
            {context.brands.map((brand) => (
              <BrandOption brand={brand} key={brand.id} />
            ))}
          </select>
          <button className="icon-button" title="Apri il brand" type="submit">
            <span aria-hidden="true">↗</span>
            <span className="sr-only">Apri il brand selezionato</span>
          </button>
        </div>
      </form>

      <nav aria-label="Navigazione principale" className="primary-nav">
        {navigation.map((item, index) => (
          <Link
            href={`/brands/${context.brand.id}/${item.path}`}
            key={item.path}
          >
            <span aria-hidden="true">0{index + 1}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar__foot">
        <p>{context.session.user.name}</p>
        <span>{context.access.role}</span>
        <SignOutButton />
      </div>
    </aside>
    <main className="workspace">{children}</main>
  </div>
)
