import Link from 'next/link'

export default function NotFoundPage() {
  return (
    <main className="system-page">
      <p className="eyebrow">404</p>
      <h1>This page is not in your workspace.</h1>
      <p>
        The resource does not exist, or your current membership cannot see it.
      </p>
      <Link className="button" href="/">
        Back to the start
      </Link>
    </main>
  )
}
