import type { Metadata } from 'next'

import { PostHogBootstrap } from '@/components/posthog-bootstrap'
import { resolveProductionPostHogToken } from '@/lib/posthog-config'

import './globals.css'

export const metadata: Metadata = {
  description:
    'La console operativa per Intent, Brand Context e lavoro tracciabile.',
  title: {
    default: 'Branderize',
    template: '%s | Branderize',
  },
}

export const instant = true

export default function RootLayout({ children }: LayoutProps<'/'>) {
  const posthogToken = resolveProductionPostHogToken(process.env)

  return (
    <html lang="it">
      <body>
        <PostHogBootstrap token={posthogToken} />
        {children}
      </body>
    </html>
  )
}
