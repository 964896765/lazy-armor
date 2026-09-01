import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = { title: '懒人装甲 Admin', description: 'P0 管理后台骨架' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
