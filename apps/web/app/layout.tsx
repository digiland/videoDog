import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'StreamZW',
  description: 'Creator-led video platform for Zimbabwe',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 min-h-screen antialiased">{children}</body>
    </html>
  );
}
