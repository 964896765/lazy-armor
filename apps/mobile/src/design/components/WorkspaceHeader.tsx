import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { spacing } from '../spacing';
import { typography } from '../typography';

export function WorkspaceHeader({ title, subtitle, action, onBack }: { title: string; subtitle?: string; action?: ReactNode; onBack?: () => void }) {
  return <View style={styles.header}>{onBack ? <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Text style={styles.backText}>‹</Text></Pressable> : null}<View style={styles.copy}><Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>{action ? <View>{action}</View> : null}</View>;
}

const styles = StyleSheet.create({
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  copy: { flex: 1 },
  back: { width: 34, height: 34, marginLeft: -4, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#344054', fontSize: 31, lineHeight: 32, fontWeight: '300' },
  pressed: { backgroundColor: '#EEF1F5' },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
