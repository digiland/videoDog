import type { ReactNode } from 'react';
import './globals.css';
import NavBar from './components/NavBar';

export const metadata = {
  title: 'StreamZW — Watch Zimbabwe',
  description: 'Stream Zimbabwean creators. Free, pay-per-view, and premium subscriptions.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#121110' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

/** No web fonts: the system stack renders instantly and costs no data. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-ink antialiased pb-tabbar" suppressHydrationWarning>
        <NavBar />
        <main>{children}</main>
        <footer className="mt-16 border-t border-line">
          <div className="max-w-screen-xl mx-auto px-4 py-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-3">
            <span>© {new Date().getFullYear()} StreamZW · Made in Zimbabwe</span>
            <a href="/pricing" className="hover:text-ink">
              Premium
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
