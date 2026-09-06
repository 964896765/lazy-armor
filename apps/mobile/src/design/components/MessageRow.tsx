import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { spacing } from '../spacing';
import { typography } from '../typography';
import { RailBadge } from './RailBadge';

export function MessageRow({ icon, title, description, meta, unread = 0, tone = 'neutral', onPress, last = false }: {
  icon: string;
  title: string;
  description: string;
  meta?: string;
  unread?: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
  onPress?: () => void;
  last?: boolean;
}) {
  const content = <><View style={[styles.icon, styles[`${tone}Icon`]]}><Text style={styles.iconText}>{icon}</Text><RailBadge count={unread} /></View><View style={styles.copy}><View style={styles.titleRow}><Text numberOfLines={1} style={styles.title}>{title}</Text>{meta ? <Text style={styles.meta}>{meta}</Text> : null}</View><Text numberOfLines={2} style={styles.description}>{description}</Text></View>{onPress ? <Text style={styles.chevron}>›</Text> : null}</>;
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}>{content}</Pressable>
    : <View style={[styles.row, !last && styles.divider]}>{content}</View>;
}

const styles = StyleSheet.create({
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  divider: { borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  pressed: { backgroundColor: '#F7F8FA' },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  neutralIcon: { backgroundColor: '#F2F4F7' },
  successIcon: { backgroundColor: '#E8F7EF' },
  warningIcon: { backgroundColor: '#FFF4E5' },
  dangerIcon: { backgroundColor: '#FDECEC' },
  brandIcon: { backgroundColor: colors.accentSoft },
  iconText: { fontSize: 17 },
  copy: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  meta: { ...typography.caption, color: colors.textMuted },
  description: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  chevron: { color: '#98A2B3', fontSize: 24, fontWeight: '300' },
});
