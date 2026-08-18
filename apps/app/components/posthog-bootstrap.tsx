'use client'

import { useEffect } from 'react'

import { initializePostHogClient } from '@/lib/posthog.client'

export const PostHogBootstrap = ({
  token,
}: {
  readonly token: string | null
}) => {
  useEffect(() => {
    if (token !== null) {
      initializePostHogClient(token).catch(() => undefined)
    }
  }, [token])

  return null
}
