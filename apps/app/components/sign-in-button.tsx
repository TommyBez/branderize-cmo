'use client'

import { createBranderizeAuthClient } from '@repo/auth/client'
import { useState } from 'react'

export const SignInButton = () => {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const signIn = async () => {
    setPending(true)
    setMessage(null)
    const client = createBranderizeAuthClient({
      environment: { NEXT_PUBLIC_APP_URL: window.location.origin },
    })
    const result = await client.signIn.social({
      callbackURL: '/',
      provider: 'google',
    })

    if (result.error !== null) {
      setMessage('Accesso non disponibile. Riprova tra poco.')
      setPending(false)
    }
  }

  return (
    <div className="auth-action">
      <button
        className="button button--wide"
        disabled={pending}
        onClick={signIn}
        type="button"
      >
        {pending ? 'Apertura in corso…' : 'Continua con Google'}
      </button>
      {message === null ? null : (
        <p className="form-feedback form-feedback--error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}
