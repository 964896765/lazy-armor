import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = { title: '懒人装甲 Operations', description: '只读运行诊断面板' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
