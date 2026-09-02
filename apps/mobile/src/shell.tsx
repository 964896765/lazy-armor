import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function ShellPage({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <View style={styles.page}><Text style={styles.eyebrow}>懒人装甲</Text><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text>{children}</View>;
}

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF', padding: 24, paddingTop: 52 },
  eyebrow: { color: '#287052', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#17251F', fontSize: 32, fontWeight: '800', marginTop: 8 },
  subtitle: { color: '#69756F', fontSize: 16, lineHeight: 24, marginTop: 8, marginBottom: 24 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E3E7E4' },
  cardTitle: { fontWeight: '700', fontSize: 17, color: '#24342C' },
  cardText: { color: '#6B7770', marginTop: 5, lineHeight: 20 },
});
