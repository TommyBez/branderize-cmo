import type { Metadata } from 'next'
import './globals.css'

export const instant = true

export const metadata: Metadata = {
  description:
    'Write what the brand is trying to do, add the website, and talk to your CMO in private.',
  openGraph: {
    description: 'Write the goal. Add the website. Keep the chat private.',
    locale: 'en_US',
    siteName: 'Branderize',
    title: 'Branderize | Direction before the work',
    type: 'website',
  },
  title: 'Branderize | Direction before the work',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
