import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'APIP — Trading Intelligence Platform',
  description: 'Analyst Performance & Intelligence Platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">
        {children}
      </body>
    </html>
  )
}
