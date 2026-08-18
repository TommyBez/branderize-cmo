import type { Metadata } from 'next'

import { PostHogBootstrap } from '@/components/posthog-bootstrap'
import { resolveProductionPostHogToken } from '@/lib/posthog-config'

import './globals.css'

export const metadata: Metadata = {
  description:
    'The workspace for goals, Brand Context, and work you can trace.',
  title: {
    default: 'Branderize',
    template: '%s | Branderize',
  },
}

export const instant = true

export default function RootLayout({ children }: LayoutProps<'/'>) {
  const posthogToken = resolveProductionPostHogToken(process.env)

  return (
    <html lang="en">
      <body>
        <PostHogBootstrap token={posthogToken} />
        {children}
      </body>
    </html>
  )
}
