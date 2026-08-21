import { usesLocalEmailOtpBypass } from '@repo/env/app-server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { StandaloneNavigationPending } from '@/components/navigation-pending'
import { SignInForm } from '@/components/sign-in-form'
import { appEnvironment } from '@/lib/auth'
import { firstAvailableBrand, readPageSession } from '@/lib/dal'

export const metadata: Metadata = { title: 'Sign in' }
export const instant = true

const SignInContent = async () => {
  const session = await readPageSession()
  if (session !== null) {
    const brand = await firstAvailableBrand(session.user.id)
    redirect(brand === null ? '/onboarding' : `/brands/${brand.id}/today`)
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <Link className="wordmark wordmark--dark" href="/sign-in">
          Branderize<span>CMO</span>
        </Link>
        <div>
          <p className="eyebrow">Your space</p>
          <h1>You can still see why something was made.</h1>
          <p className="lede">
            The goal and the website stay with the work. The chat stays yours.
          </p>
        </div>
        <p className="folio">Early access</p>
      </section>
      <section className="auth-panel">
        <div className="auth-panel__inner">
          <p className="eyebrow">Sign in</p>
          <h2>Enter your email. We’ll send a code.</h2>
          <p>No password. You only see brands you belong to.</p>
          <SignInForm
            localOtpBypass={usesLocalEmailOtpBypass(appEnvironment)}
          />
          <small>
            The code is only for you. Nobody else can read your CMO chats.
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
          eyebrow="Sign in"
          status="Checking for an existing session."
          title="Checking your session."
        />
      }
    >
      <SignInContent />
    </Suspense>
  )
}
