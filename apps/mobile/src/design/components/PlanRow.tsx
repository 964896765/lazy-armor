import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { workspaceColors as colors } from '../workspace';
import { spacing } from '../spacing';
import { typography } from '../typography';

export function PlanRow({ icon, name, description, detail, status, statusTone = 'success', onPress, last = false }: {
  icon: ComponentProps<typeof Ionicons>['name'];
  name: string;
  description: string;
  detail: string;
  status: string;
  statusTone?: 'success' | 'warning' | 'muted';
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}>
      <View style={[styles.icon, styles[`${statusTone}Icon`]]}><Ionicons name={icon} size={19} color={statusTone === 'warning' ? colors.warning : statusTone === 'muted' ? colors.textMuted : colors.primary} /></View>
      <View style={styles.copy}>
        <View style={styles.titleRow}><Text numberOfLines={1} style={styles.name}>{name}</Text><View style={[styles.status, styles[`${statusTone}Status`]]}><Text style={[styles.statusText, styles[`${statusTone}Text`]]}>{status}</Text></View></View>
        <Text numberOfLines={1} style={styles.description}>{description}</Text>
        <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 98, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { backgroundColor: '#F7F8FA' },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  successIcon: { backgroundColor: '#E8F7EF' },
  warningIcon: { backgroundColor: '#FFF4E5' },
  mutedIcon: { backgroundColor: '#F2F4F7' },
  copy: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.bodyStrong, fontSize: 15, lineHeight: 22, color: colors.text, flex: 1 },
  description: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  detail: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  status: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  successStatus: { backgroundColor: '#E8F7EF' },
  warningStatus: { backgroundColor: '#FFF4E5' },
  mutedStatus: { backgroundColor: '#F2F4F7' },
  statusText: { fontSize: 11, lineHeight: 17, fontWeight: '600' },
  successText: { color: '#16834A' },
  warningText: { color: '#B54708' },
  mutedText: { color: '#667085' },
});
