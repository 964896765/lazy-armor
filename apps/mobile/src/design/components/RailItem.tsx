import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';
import { RailBadge } from './RailBadge';

export function RailItem({ label, symbol, imageUri, selected = false, status, badgeCount = 0, tone = 'default', onPress }: {
  label: string;
  symbol: string;
  imageUri?: string | null;
  selected?: boolean;
  status?: 'healthy' | 'warning' | 'offline';
  badgeCount?: number;
  tone?: 'default' | 'brand' | 'commerce' | 'action' | 'account';
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.item, selected && styles.selected, pressed && styles.pressed]}>
      {selected ? <View style={styles.selectionMark} /> : null}
      <View style={[styles.icon, styles[`${tone}Icon`]]}>
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.image} /> : <Text style={[styles.symbol, styles[`${tone}Symbol`]]}>{symbol}</Text>}
        {status ? <View style={[styles.status, status === 'healthy' ? styles.healthy : status === 'warning' ? styles.warning : styles.offline]}>{status === 'warning' ? <Text style={styles.statusText}>!</Text> : null}</View> : null}
        <RailBadge count={badgeCount} />
      </View>
      <Text numberOfLines={1} style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { width: '100%', minHeight: 53, alignItems: 'center', justifyContent: 'center', paddingVertical: 3, position: 'relative', borderRadius: 13 },
  selected: { backgroundColor: '#EEF3FF' },
  pressed: { opacity: 0.72 },
  selectionMark: { position: 'absolute', left: -5, width: 4, height: 28, borderRadius: 3, backgroundColor: '#5865F2' },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#EEF1F5', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'visible' },
  image: { width: 36, height: 36, borderRadius: 12 },
  defaultIcon: { backgroundColor: '#EDF1F5' },
  brandIcon: { backgroundColor: '#5865F2' },
  commerceIcon: { backgroundColor: '#F47B32' },
  actionIcon: { backgroundColor: '#F2F4F7', borderWidth: 1, borderColor: '#D8DDE5' },
  accountIcon: { borderRadius: 18, backgroundColor: '#344054' },
  symbol: { color: '#344054', fontSize: 15, fontWeight: '800' },
  defaultSymbol: { color: '#344054' },
  brandSymbol: { color: '#FFFFFF' },
  commerceSymbol: { color: '#FFFFFF' },
  actionSymbol: { color: '#475467', fontSize: 23, lineHeight: 25, fontWeight: '400' },
  accountSymbol: { color: '#FFFFFF' },
  label: { width: 50, color: '#475467', fontSize: 8, lineHeight: 11, fontWeight: '600', textAlign: 'center', marginTop: 2 },
  selectedLabel: { color: '#1D2939', fontWeight: '800' },
  status: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  healthy: { backgroundColor: '#23A559' },
  warning: { backgroundColor: '#F79009' },
  offline: { backgroundColor: '#98A2B3' },
  statusText: { color: '#FFFFFF', fontSize: 7, lineHeight: 7, fontWeight: '900' },
});
