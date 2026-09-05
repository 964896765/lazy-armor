import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';

export function RailBadge({ count, tone = 'danger' }: { count: number; tone?: 'danger' | 'neutral' }) {
  if (count <= 0) return null;
  return <View style={[styles.badge, tone === 'neutral' && styles.neutral]}><Text style={styles.text}>{count > 99 ? '99+' : count}</Text></View>;
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', right: -5, top: -5, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.danger, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  neutral: { backgroundColor: '#667085' },
  text: { color: '#FFFFFF', fontSize: 8, lineHeight: 10, fontWeight: '800' },
});
