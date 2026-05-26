import type { ReactNode } from 'react';
import './globals.css';
import NavBar from './components/NavBar';

export const metadata = {
  title: 'StreamZW',
  description: 'Creator-led video platform for Zimbabwe',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0f0f23] text-white min-h-screen antialiased">
        <NavBar />
        <main>{children}</main>
      </body>
    </html>
  );
}
