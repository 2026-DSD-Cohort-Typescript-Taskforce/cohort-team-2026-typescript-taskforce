import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { APP_NAME } from '../components/layout/brand';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: 'Every bill, handled.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex h-dvh flex-col overflow-hidden font-sans">{children}</body>
    </html>
  );
}
