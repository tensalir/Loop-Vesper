import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { QueryProvider } from "@/components/providers/QueryProvider"
import { ErrorBoundary } from "@/components/ErrorBoundary"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Loop Vesper - Your Intelligent AI Canvas",
  description: "Generate images and videos with state-of-the-art AI models",
  icons: {
    icon: '/images/Loop-Favicon-(Mint).png',
    shortcut: '/images/Loop-Favicon-(Mint).png',
    apple: '/images/Loop-Favicon-(Mint).png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <ErrorBoundary>
          <QueryProvider>
            {children}
          </QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}

