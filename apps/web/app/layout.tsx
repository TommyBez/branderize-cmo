import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  description: 'Web app powered by @repo/ui',
  title: 'Web',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} dark`}
      lang="en"
    >
      <body className="antialiased">{children}</body>
    </html>
  )
}
