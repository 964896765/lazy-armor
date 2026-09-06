import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { colors } from '../colors';
import { RailBadge } from './RailBadge';

export function RailItem({ label, symbol, imageUri, imageSource, imageScale = 1, selected = false, status, badgeCount = 0, tone = 'default', showLabel = true, onPress }: {
  label: string;
  symbol: string;
  imageUri?: string | null;
  imageSource?: ImageSourcePropType;
  imageScale?: number;
  selected?: boolean;
  status?: 'healthy' | 'warning' | 'offline';
  badgeCount?: number;
  tone?: 'default' | 'brand' | 'commerce' | 'action' | 'account';
  showLabel?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.item, selected && styles.selected, pressed && styles.pressed]}>
      {selected ? <View style={styles.selectionMark} /> : null}
      <View style={[styles.icon, styles[`${tone}Icon`]]}>
        {imageSource ? <Image source={imageSource} style={[styles.image, imageScale !== 1 && { transform: [{ scale: imageScale }] }]} /> : imageUri ? <Image source={{ uri: imageUri }} style={styles.image} /> : <Text style={[styles.symbol, styles[`${tone}Symbol`]]}>{symbol}</Text>}
        {status ? <View style={[styles.status, status === 'healthy' ? styles.healthy : status === 'warning' ? styles.warning : styles.offline]}>{status === 'warning' ? <Text style={styles.statusText}>!</Text> : null}</View> : null}
        <RailBadge count={badgeCount} />
      </View>
      {showLabel ? <Text numberOfLines={1} style={[styles.label, selected && styles.selectedLabel]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { width: '100%', minHeight: 43, alignItems: 'center', justifyContent: 'center', paddingVertical: 2, position: 'relative', borderRadius: 12 },
  selected: { backgroundColor: '#DDF4ED' },
  pressed: { opacity: 0.72 },
  selectionMark: { position: 'absolute', left: -5, width: 3, height: 24, borderRadius: 3, backgroundColor: '#087A5A' },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#EDF5F2', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'visible' },
  image: { width: 32, height: 32, borderRadius: 10 },
  defaultIcon: { backgroundColor: '#EDF5F2' },
  brandIcon: { backgroundColor: '#087A5A' },
  commerceIcon: { backgroundColor: '#F47B32' },
  actionIcon: { backgroundColor: '#E8F4F0', borderWidth: 1, borderColor: '#CFE3DC' },
  accountIcon: { borderRadius: 18, backgroundColor: '#344054' },
  symbol: { color: '#344054', fontSize: 15, fontWeight: '800' },
  defaultSymbol: { color: '#344054' },
  brandSymbol: { color: '#FFFFFF' },
  commerceSymbol: { color: '#FFFFFF' },
  actionSymbol: { color: '#475467', fontSize: 23, lineHeight: 25, fontWeight: '400' },
  accountSymbol: { color: '#FFFFFF' },
  label: { width: 44, color: '#66758A', fontSize: 7, lineHeight: 10, fontWeight: '600', textAlign: 'center', marginTop: 1 },
  selectedLabel: { color: '#13233A', fontWeight: '800' },
  status: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  healthy: { backgroundColor: '#23A559' },
  warning: { backgroundColor: '#F79009' },
  offline: { backgroundColor: '#98A2B3' },
  statusText: { color: '#FFFFFF', fontSize: 7, lineHeight: 7, fontWeight: '900' },
});
