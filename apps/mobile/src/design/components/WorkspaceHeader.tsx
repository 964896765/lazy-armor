import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { workspaceColors as colors } from '../workspace';
import { spacing } from '../spacing';
import { typography } from '../typography';

export function WorkspaceHeader({ title, action, onBack }: { title: string; subtitle?: string; action?: ReactNode; onBack?: () => void }) {
  return <View style={styles.header}>{onBack ? <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBack} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable> : null}<View style={styles.copy}><Text numberOfLines={1} ellipsizeMode="tail" style={styles.title}>{title}</Text></View>{action ? <View>{action}</View> : null}</View>;
}

const styles = StyleSheet.create({
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  back: { width: 40, height: 40, marginLeft: -6, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.pressed },
  title: { ...typography.navigationTitle, color: colors.text },
});
