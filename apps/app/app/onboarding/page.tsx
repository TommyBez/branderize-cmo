import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { StandaloneNavigationPending } from '@/components/navigation-pending'
import { OnboardingForm } from '@/components/onboarding-form'
import { listUserOrganizations, requirePageSession } from '@/lib/dal'

export const metadata: Metadata = { title: 'Nuovo brand' }
export const instant = true

const OnboardingContent = async () => {
  const session = await requirePageSession()
  const organizations = await listUserOrganizations(session.user.id)

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <span className="wordmark wordmark--dark">
          Branderize<span>CMO</span>
        </span>
        <p>{session.user.email}</p>
      </header>
      <div className="onboarding-grid">
        <section className="onboarding-copy">
          <p className="eyebrow">01 · Origine</p>
          <h1>Costruiamo il primo punto fermo del brand.</h1>
          <p className="lede">
            Il sito diventa una fonte verificabile. L’Intent dice invece quale
            cambiamento vuoi ottenere: sono due cose diverse, entrambe
            canoniche.
          </p>
          <ol className="editorial-steps">
            <li>
              <span>01</span>
              Brand e website
            </li>
            <li>
              <span>02</span>
              Intent iniziale
            </li>
            <li>
              <span>03</span>
              Import del contesto
            </li>
          </ol>
        </section>
        <section className="onboarding-form-panel">
          <p className="eyebrow">Dettagli canonici</p>
          <OnboardingForm
            organizations={organizations}
            requestId={randomUUID()}
          />
        </section>
      </div>
    </main>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <StandaloneNavigationPending
          eyebrow="Nuovo brand"
          status="Preparazione del nuovo brand in corso."
          title="Preparo il primo punto fermo."
        />
      }
    >
      <OnboardingContent />
    </Suspense>
  )
}
