import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './design';

export function ShellPage({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <View style={styles.page}><Text style={styles.eyebrow}>懒人装甲</Text><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text>{children}</View>;
}

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, padding: 24, paddingTop: 32 },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  title: { color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '700', marginTop: 6 },
  subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 23, marginTop: 8, marginBottom: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontWeight: '700', fontSize: 17, color: colors.text },
  cardText: { color: colors.textSecondary, marginTop: 5, lineHeight: 20 },
});
