import Link from 'next/link'

export default function NotFoundPage() {
  return (
    <main className="system-page">
      <p className="eyebrow">404</p>
      <h1>Questa pagina non appartiene al tuo spazio.</h1>
      <p>La risorsa non esiste oppure la membership corrente non la espone.</p>
      <Link className="button" href="/">
        Torna all’inizio
      </Link>
    </main>
  )
}
