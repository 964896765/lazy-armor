import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { spacing } from '../spacing';
import { typography } from '../typography';
import { Surface } from './Surface';

export function TodayCard({ title = '今天帮你处理', items, footnote }: { title?: string; items: string[]; footnote?: string }) {
  return (
    <Surface>
      <Text style={styles.label}>{title}</Text>
      <View style={styles.items}>
        {items.map((item, index) => (
          <View key={`${item}:${index}`} style={styles.row}>
            <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>
            <Text style={styles.item}>{item}</Text>
          </View>
        ))}
      </View>
      {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.label, color: colors.success, textTransform: 'uppercase' },
  items: { gap: spacing.md, marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  check: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: colors.success, fontWeight: '800' },
  item: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  footnote: { ...typography.caption, color: colors.textMuted, marginTop: spacing.lg },
});
