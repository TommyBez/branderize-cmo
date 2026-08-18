import { usesLocalEmailOtpBypass } from '@repo/env/app-server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { StandaloneNavigationPending } from '@/components/navigation-pending'
import { SignInForm } from '@/components/sign-in-form'
import { appEnvironment } from '@/lib/auth'
import { firstAvailableBrand, readPageSession } from '@/lib/dal'

export const metadata: Metadata = { title: 'Accedi' }
export const instant = true

const SignInContent = async () => {
  const session = await readPageSession()
  if (session !== null) {
    const brand = await firstAvailableBrand(session.user.id)
    redirect(brand === null ? '/onboarding' : `/brands/${brand.id}/intent`)
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <Link className="wordmark wordmark--dark" href="/sign-in">
          Branderize<span>CMO</span>
        </Link>
        <div>
          <p className="eyebrow">Canonical marketing operations</p>
          <h1>Una memoria di brand che mostra sempre da dove viene.</h1>
          <p className="lede">
            Intent, contesto e lavoro degli agenti restano leggibili come un
            unico filo, senza perdere attori e provenienza.
          </p>
        </div>
        <p className="folio">Private alpha · Phase 0</p>
      </section>
      <section className="auth-panel">
        <div className="auth-panel__inner">
          <p className="eyebrow">Area riservata</p>
          <h2>Entra nel tuo atelier operativo.</h2>
          <p>
            Inserisci la tua email e poi il codice monouso per accedere; brand e
            conversazioni dipendono sempre dalla membership corrente.
          </p>
          <SignInForm
            localOtpBypass={usesLocalEmailOtpBypass(appEnvironment)}
          />
          <small>
            Il codice è personale. Nessuna conversazione CMO è condivisa con
            altri membri.
          </small>
        </div>
      </section>
    </main>
  )
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <StandaloneNavigationPending
          eyebrow="Area riservata"
          status="Verifica della sessione in corso."
          title="Verifico la sessione."
        />
      }
    >
      <SignInContent />
    </Suspense>
  )
}
