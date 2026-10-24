import type { Metadata, Viewport } from 'next';
import { Caveat, Nunito } from 'next/font/google';
import './globals.css';

const ui = Nunito({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const hand = Caveat({ subsets: ['latin'], variable: '--font-hand', display: 'swap' });

export const metadata: Metadata = {
  title: 'Mewwo',
  description: 'Two hearts, one little life. Raise a kitten together in a shared 3D home.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f6efe3',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
