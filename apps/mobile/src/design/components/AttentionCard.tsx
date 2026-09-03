import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { spacing } from '../spacing';
import { typography } from '../typography';
import { ActionButton } from './ActionButton';
import { Surface } from './Surface';

export function AttentionCard({ title, description, detail, actionLabel = '查看', onPress, secondaryAction }: {
  title: string;
  description: string;
  detail?: string;
  actionLabel?: string;
  onPress?: () => void;
  secondaryAction?: { label: string; onPress: () => void };
}) {
  return (
    <Surface style={styles.card}>
      <View style={styles.labelRow}><View style={styles.dot} /><Text style={styles.label}>需要你处理</Text></View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {onPress || secondaryAction ? (
        <View style={styles.actions}>
          {secondaryAction ? <ActionButton label={secondaryAction.label} tone="quiet" onPress={secondaryAction.onPress} /> : null}
          {onPress ? <ActionButton label={actionLabel} onPress={onPress} /> : null}
        </View>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { borderColor: colors.warning, borderWidth: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
  label: { ...typography.label, color: colors.warning },
  title: { ...typography.cardTitle, color: colors.text },
  description: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  detail: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
});
