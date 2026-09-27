import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors, WorkspaceHeader } from './design';

export function ShellPage({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <View style={styles.page}><WorkspaceHeader title={title} onBack={() => router.back()} /><Text style={styles.subtitle}>{subtitle}</Text>{children}</View>;
}

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, padding: 24, paddingTop: 16 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 4, marginBottom: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontWeight: '700', fontSize: 17, color: colors.text },
  cardText: { color: colors.textSecondary, marginTop: 5, lineHeight: 20 },
});
