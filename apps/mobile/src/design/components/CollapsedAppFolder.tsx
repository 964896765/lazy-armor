import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../colors';

export function CollapsedAppFolder({ count, iconUris, onPress }: { count: number; iconUris: string[]; onPress: () => void }) {
  if (count <= 0) return null;
  const previews = [...iconUris.slice(0, 4), ...Array(Math.max(0, 4 - iconUris.length)).fill(null)].slice(0, 4) as Array<string | null>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`其他 App ${count}`} onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
      <View style={styles.folder}>{previews.map((uri, index) => uri ? <Image key={`${uri}:${index}`} source={{ uri }} style={styles.preview} /> : <View key={`empty:${index}`} style={[styles.preview, styles.placeholder]} />)}<View style={styles.count}><Text style={styles.countText}>{count > 99 ? '99+' : count}</Text></View></View>
      <Text numberOfLines={1} style={styles.label}>其他 App</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { width: '100%', minHeight: 53, alignItems: 'center', justifyContent: 'center', paddingVertical: 3, borderRadius: 13 },
  pressed: { opacity: 0.72 },
  folder: { width: 36, height: 36, padding: 4, borderRadius: 12, backgroundColor: '#F2F4F7', flexDirection: 'row', flexWrap: 'wrap', gap: 3, position: 'relative' },
  preview: { width: 12, height: 12, borderRadius: 4 },
  placeholder: { backgroundColor: '#D0D5DD' },
  count: { position: 'absolute', right: -6, top: -6, minWidth: 18, height: 18, paddingHorizontal: 3, borderRadius: 9, backgroundColor: '#5865F2', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#FFFFFF', fontSize: 8, lineHeight: 10, fontWeight: '800' },
  label: { width: 50, color: colors.textSecondary, fontSize: 8, lineHeight: 11, fontWeight: '600', textAlign: 'center', marginTop: 2 },
});
