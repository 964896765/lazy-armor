import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { spacing } from '../spacing';
import { typography } from '../typography';
import { ActionButton } from './ActionButton';
import { Surface } from './Surface';

export function ConnectionCard({ name, status, helpsWith, onManage }: { name: string; status: string; helpsWith: string[]; onManage: () => void }) {
  return (
    <Surface>
      <View style={styles.header}><Text style={styles.name}>{name}</Text><Text style={styles.status}>{status}</Text></View>
      <Text style={styles.label}>正在帮助</Text>
      {helpsWith.map((item) => <Text key={item} style={styles.item}>· {item}</Text>)}
      <View style={styles.action}><ActionButton label="管理" tone="quiet" onPress={onManage} /></View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  name: { ...typography.cardTitle, color: colors.text },
  status: { ...typography.caption, color: colors.success },
  label: { ...typography.label, color: colors.textMuted, marginTop: spacing.xl, marginBottom: spacing.sm },
  item: { ...typography.body, color: colors.textSecondary },
  action: { alignItems: 'flex-end', marginTop: spacing.lg },
});
