import { Pressable, StyleSheet, Text } from 'react-native';
import { workspaceColors as colors } from '../workspace';
import { radius } from '../radius';
import { spacing } from '../spacing';
import { typography } from '../typography';

export function ActionButton({ label, onPress, tone = 'primary', disabled = false }: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [buttonStyles.base, buttonStyles[tone], pressed && buttonStyles.pressed, disabled && buttonStyles.disabled]}
    >
      <Text style={[buttonStyles.label, tone === 'quiet' ? buttonStyles.quietLabel : buttonStyles.solidLabel]}>{label}</Text>
    </Pressable>
  );
}

const buttonStyles = StyleSheet.create({
  base: { minHeight: 48, paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.primary },
  quiet: { backgroundColor: colors.accentSoft },
  danger: { backgroundColor: colors.danger },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
  label: typography.bodyStrong,
  solidLabel: { color: colors.surface },
  quietLabel: { color: colors.primary },
});
