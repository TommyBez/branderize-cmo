'use client'

import { createBranderizeAuthClient } from '@repo/auth/client'
import { useState } from 'react'

export const SignOutButton = () => {
  const [pending, setPending] = useState(false)

  const signOut = async () => {
    setPending(true)
    const client = createBranderizeAuthClient({
      environment: { NEXT_PUBLIC_APP_URL: window.location.origin },
    })
    await client.signOut()
    window.location.assign('/sign-in')
  }

  return (
    <button
      className="text-button"
      disabled={pending}
      onClick={signOut}
      type="button"
    >
      {pending ? 'Uscita…' : 'Esci'}
    </button>
  )
}
