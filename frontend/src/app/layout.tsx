// Root layout — wraps every page in the app
// This is a Server Component (no 'use client') — good for metadata/SEO
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const inter = Inter({
  subsets: ['latin'],
  // Display strategy: show system font immediately, swap to Inter when loaded
  // Prevents layout shift (CLS) while custom font loads
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'FlowForge',
    template: '%s | FlowForge',   // "Board | FlowForge" for nested pages
  },
  description: 'FlowForge — Modern project management for engineering teams',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        {/*
          Providers wraps everything in QueryClient + auth initialization.
          It must be a Client Component, which is why it's separate from this
          Server Component layout file.
        */}
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
