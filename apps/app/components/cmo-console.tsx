'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

import type { CmoConsoleProps } from './cmo-console-types'
import { UnavailableRecovery } from './cmo-console-view'
import { InteractiveCmoConsole } from './interactive-cmo-console'
import { RecoveringCmoConsole } from './recovering-cmo-console'

export const CmoConsole = (props: CmoConsoleProps) => {
  const router = useRouter()
  const refresh = useCallback(() => router.refresh(), [router])

  if (!props.recoveryRequired) {
    return <InteractiveCmoConsole {...props} />
  }
  if (props.initialSession === undefined) {
    return (
      <UnavailableRecovery events={props.initialEvents} onRefresh={refresh} />
    )
  }
  return (
    <RecoveringCmoConsole {...props} initialSession={props.initialSession} />
  )
}
