import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, Newsreader } from 'next/font/google'

import './globals.css'

export const instant = true

const display = Newsreader({
  display: 'swap',
  subsets: ['latin'],
  variable: '--font-newsreader',
})

const body = IBM_Plex_Sans({
  display: 'swap',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-plex',
  weight: ['300', '400', '500', '600'],
})

export const metadata: Metadata = {
  description:
    'Write what the brand is trying to do. Add the website. A CMO and specialists work against that goal. Nothing public without you.',
  openGraph: {
    description:
      'Write the goal. Add the website. A CMO you can trust runs the work.',
    locale: 'en_US',
    siteName: 'Branderize',
    title: 'Branderize | The AI CMO you can trust',
    type: 'website',
  },
  title: 'Branderize | The AI CMO you can trust',
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f3f0e7',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html className={`${display.variable} ${body.variable}`} lang="en">
      <body>{children}</body>
    </html>
  )
}
