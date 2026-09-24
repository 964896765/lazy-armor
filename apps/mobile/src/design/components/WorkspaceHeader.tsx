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
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingBottom: spacing.xs },
  copy: { flex: 1, minWidth: 0 },
  back: { width: 34, height: 34, marginLeft: -4, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.pressed },
  title: { ...typography.title, fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: 0, color: colors.text },
});
