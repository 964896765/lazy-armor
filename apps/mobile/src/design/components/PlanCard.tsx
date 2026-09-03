import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { radius } from '../radius';
import { spacing } from '../spacing';
import { typography } from '../typography';

export function PlanCard({ icon, name, description, status, nextRun, onPress, statusTone = 'success' }: {
  icon: string;
  name: string;
  description: string;
  status: string;
  nextRun: string;
  onPress?: () => void;
  statusTone?: 'success' | 'warning' | 'muted';
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && onPress ? styles.pressed : null]}
    >
      <View style={styles.icon}><Text style={styles.iconText}>{icon}</Text></View>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.description}>{description}</Text>
      <View style={styles.footer}>
        <View style={styles.status}>
          <View style={[styles.dot, styles[`${statusTone}Dot`]]} />
          <Text style={[styles.statusText, styles[`${statusTone}Text`]]}>{status}</Text>
        </View>
        <Text style={styles.nextRun}>{nextRun}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  icon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  iconText: { fontSize: 21 },
  name: { ...typography.cardTitle, color: colors.text },
  description: { ...typography.body, color: colors.textSecondary },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  successDot: { backgroundColor: colors.success },
  warningDot: { backgroundColor: colors.warning },
  mutedDot: { backgroundColor: colors.textMuted },
  statusText: { ...typography.caption },
  successText: { color: colors.success },
  warningText: { color: colors.warning },
  mutedText: { color: colors.textMuted },
  nextRun: { ...typography.caption, color: colors.textMuted, flexShrink: 1, textAlign: 'right' },
});
