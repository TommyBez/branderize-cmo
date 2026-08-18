import type { Metadata } from 'next'
import './globals.css'

export const instant = true

export const metadata: Metadata = {
  description:
    'Branderize organizza Intent, contesto verificabile, conversazioni private con il CMO e provenienza del lavoro di marketing.',
  openGraph: {
    description:
      'Un punto di partenza verificabile per il lavoro di marketing del tuo brand.',
    locale: 'it_IT',
    siteName: 'Branderize',
    title: 'Branderize | Il sistema operativo del tuo marketing',
    type: 'website',
  },
  title: 'Branderize | Il sistema operativo del tuo marketing',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  )
}
