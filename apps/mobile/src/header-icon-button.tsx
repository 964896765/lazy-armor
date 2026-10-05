import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { consumerTokens } from './consumer-ui';

export function HeaderIconButton({ icon, label, onPress, disabled = false, loading = false }: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled, busy: loading }} disabled={disabled || loading} onPress={onPress}
    style={({ pressed }) => [styles.button, pressed && styles.pressed, (disabled || loading) && styles.disabled]}>
    {loading ? <ActivityIndicator size="small" color={consumerTokens.text} />
      : <Ionicons name={icon} size={21} color={consumerTokens.text} />}
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
