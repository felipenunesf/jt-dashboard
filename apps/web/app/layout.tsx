import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'JT Dashboard',
  description: 'Atribuição Meta Ads + WhatsApp + GHL — JT Advocacia Médica',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
