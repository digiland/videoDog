import type { ReactNode } from 'react';
import './globals.css';
import AppShell from './components/shell/AppShell';

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
        <AppShell
          footer={
            <footer className="mt-16 border-t border-line">
              <div className="flex flex-wrap gap-x-6 gap-y-2 px-4 py-8 text-sm text-ink-3 md:px-6">
                <span>© {new Date().getFullYear()} StreamZW · Made in Zimbabwe</span>
                <a href="/pricing" className="hover:text-ink">
                  Premium
                </a>
                <a href="/courses" className="hover:text-ink">
                  Courses
                </a>
                <a href="/me/apply" className="hover:text-ink">
                  Become a creator
                </a>
              </div>
            </footer>
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
