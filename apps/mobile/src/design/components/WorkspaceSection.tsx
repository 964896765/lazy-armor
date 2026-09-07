import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { spacing } from '../spacing';
import { typography } from '../typography';

export function WorkspaceSection({ title, count, action, children }: { title: string; count?: number; action?: { label: string; onPress: () => void }; children: ReactNode }) {
  return <View style={styles.section}><View style={styles.header}><View style={styles.titleRow}><Text style={styles.title}>{title}</Text>{count ? <View style={styles.count}><Text style={styles.countText}>{count}</Text></View> : null}</View>{action ? <Pressable onPress={action.onPress} style={({ pressed }) => pressed && styles.pressed}><Text style={styles.action}>{action.label}</Text></Pressable> : null}</View>{children}</View>;
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl },
  header: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.section, color: colors.text },
  count: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: '#EEF1F5', alignItems: 'center', justifyContent: 'center' },
  countText: { color: colors.textSecondary, fontSize: 10, lineHeight: 12, fontWeight: '800' },
  action: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
