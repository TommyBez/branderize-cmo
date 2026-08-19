import type { Metadata } from 'next'
import './globals.css'

export const instant = true

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

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
