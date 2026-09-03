import type { TextStyle } from 'react-native';

export const typography = {
  display: { fontSize: 30, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6 } satisfies TextStyle,
  title: { fontSize: 22, lineHeight: 29, fontWeight: '700', letterSpacing: -0.2 } satisfies TextStyle,
  section: { fontSize: 18, lineHeight: 25, fontWeight: '700' } satisfies TextStyle,
  cardTitle: { fontSize: 17, lineHeight: 24, fontWeight: '700' } satisfies TextStyle,
  body: { fontSize: 15, lineHeight: 23, fontWeight: '400' } satisfies TextStyle,
  bodyStrong: { fontSize: 15, lineHeight: 23, fontWeight: '600' } satisfies TextStyle,
  caption: { fontSize: 13, lineHeight: 19, fontWeight: '400' } satisfies TextStyle,
  label: { fontSize: 12, lineHeight: 17, fontWeight: '700', letterSpacing: 0.4 } satisfies TextStyle,
} as const;
