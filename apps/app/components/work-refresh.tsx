'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { isActiveWorkStatus } from '@/lib/presentation'

const POLL_INTERVAL_MS = 2000

export const WorkRefresh = ({ status }: { readonly status: string }) => {
  const router = useRouter()
  const shouldPoll = isActiveWorkStatus(status)

  useEffect(() => {
    if (!shouldPoll) {
      return
    }
    const timer = window.setInterval(() => {
      router.refresh()
    }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [router, shouldPoll])

  return null
}
