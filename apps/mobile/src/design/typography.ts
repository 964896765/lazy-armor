import type { TextStyle } from 'react-native';

export const typography = {
  pageTitle: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: 0 } satisfies TextStyle,
  navigationTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600', letterSpacing: 0 } satisfies TextStyle,
  display: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: 0 } satisfies TextStyle,
  title: { fontSize: 18, lineHeight: 25, fontWeight: '700', letterSpacing: -0.1 } satisfies TextStyle,
  section: { fontSize: 16, lineHeight: 22, fontWeight: '700' } satisfies TextStyle,
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' } satisfies TextStyle,
  body: { fontSize: 14, lineHeight: 21, fontWeight: '400' } satisfies TextStyle,
  bodyStrong: { fontSize: 14, lineHeight: 21, fontWeight: '600' } satisfies TextStyle,
  caption: { fontSize: 13, lineHeight: 20, fontWeight: '400' } satisfies TextStyle,
  label: { fontSize: 12, lineHeight: 18, fontWeight: '600', letterSpacing: 0 } satisfies TextStyle,
} as const;
