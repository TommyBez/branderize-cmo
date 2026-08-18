'use client'

import { useEffect } from 'react'

import { captureSyntheticClientRenderError } from '@/lib/posthog.client'

export default function GlobalError({
  reset,
}: {
  readonly error: Error & { readonly digest?: string }
  readonly reset: () => void
}) {
  useEffect(() => {
    captureSyntheticClientRenderError()
  }, [])

  return (
    <main className="system-page">
      <p className="eyebrow">Service unavailable</p>
      <h1>We can’t show this state right now.</h1>
      <p>Nothing was invented locally. Try again when the service is back.</p>
      <button className="button" onClick={reset} type="button">
        Try again
      </button>
    </main>
  )
}
