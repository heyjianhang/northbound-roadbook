import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
export const metadata: Metadata = {
  title: '北行路书 · 去看秋天',
  description: '六日呼伦贝尔自驾路书。沈阳出发，收藏沿途的秋天。',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: '北行路书', statusBarStyle: 'default' },
  icons: { icon: '/favicon.svg', apple: '/icons/apple-touch-icon.png' },
};
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#faf8f4',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到内容
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
