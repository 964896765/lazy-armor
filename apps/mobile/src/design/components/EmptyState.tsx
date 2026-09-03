import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { spacing } from '../spacing';
import { typography } from '../typography';
import { ActionButton } from './ActionButton';

export function EmptyState({ icon = '☀️', title, description, suggestion, action }: {
  icon?: string;
  title: string;
  description?: string;
  suggestion?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {suggestion ? <View style={styles.suggestion}><Text style={styles.suggestionLabel}>试试</Text><Text style={styles.suggestionText}>“{suggestion}”</Text></View> : null}
      {action ? <View style={styles.action}><ActionButton label={action.label} onPress={action.onPress} /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xxxl },
  icon: { fontSize: 32, marginBottom: spacing.lg },
  title: { ...typography.cardTitle, color: colors.text, textAlign: 'center' },
  description: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  suggestion: { backgroundColor: colors.accentSoft, borderRadius: 16, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.xl, alignItems: 'center' },
  suggestionLabel: { ...typography.label, color: colors.textMuted },
  suggestionText: { ...typography.bodyStrong, color: colors.primary, marginTop: spacing.xs },
  action: { marginTop: spacing.xl },
});
