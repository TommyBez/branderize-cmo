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
      <p className="eyebrow">Confine non disponibile</p>
      <h1>Non possiamo proiettare questo stato adesso.</h1>
      <p>
        Nessuna alternativa locale è stata usata. Riprova quando il servizio è
        tornato disponibile.
      </p>
      <button className="button" onClick={reset} type="button">
        Riprova
      </button>
    </main>
  )
}
