import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { spacing } from '../spacing';
import { typography } from '../typography';

export function PlanRow({ icon, name, description, detail, status, statusTone = 'success', onPress, last = false }: {
  icon: string;
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
      <View style={[styles.icon, styles[`${statusTone}Icon`]]}><Text style={styles.iconText}>{icon}</Text></View>
      <View style={styles.copy}>
        <View style={styles.titleRow}><Text numberOfLines={1} style={styles.name}>{name}</Text><View style={[styles.status, styles[`${statusTone}Status`]]}><Text style={[styles.statusText, styles[`${statusTone}Text`]]}>{status}</Text></View></View>
        <Text numberOfLines={1} style={styles.description}>{description}</Text>
        <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  divider: { borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  pressed: { backgroundColor: '#F7F8FA' },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  successIcon: { backgroundColor: '#E8F7EF' },
  warningIcon: { backgroundColor: '#FFF4E5' },
  mutedIcon: { backgroundColor: '#F2F4F7' },
  iconText: { fontSize: 17 },
  copy: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  description: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  detail: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 1 },
  status: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  successStatus: { backgroundColor: '#E8F7EF' },
  warningStatus: { backgroundColor: '#FFF4E5' },
  mutedStatus: { backgroundColor: '#F2F4F7' },
  statusText: { fontSize: 9, lineHeight: 13, fontWeight: '700' },
  successText: { color: '#16834A' },
  warningText: { color: '#B54708' },
  mutedText: { color: '#667085' },
  chevron: { color: '#98A2B3', fontSize: 24, fontWeight: '300' },
});
