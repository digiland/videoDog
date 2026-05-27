import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';
import NavBar from './components/NavBar';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata = {
  title: 'StreamZW — Watch Zimbabwe',
  description: 'Stream Zimbabwean creators. Free, pay-per-view, and premium subscriptions.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen bg-bg text-ink antialiased" suppressHydrationWarning>
        <NavBar />
        <main>{children}</main>
        <footer className="mt-24 border-t border-line">
          <div className="max-w-screen-2xl mx-auto px-6 py-10 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-sm text-ink-dim">
            <div className="font-bold text-ink">
              Stream<span className="text-accent">ZW</span>
            </div>
            <div>© {new Date().getFullYear()} StreamZW · Made in Zimbabwe</div>
          </div>
        </footer>
      </body>
    </html>
  );
}
