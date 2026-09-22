import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectionRail, shellLayout } from '../../src/lazy-armor-shell';

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  return (
    <View style={styles.container}><Tabs
      tabBar={(props) => <ConnectionRail {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: 'left',
        sceneStyle: compact ? { marginTop: shellLayout.mobileHeaderHeight } : { marginLeft: shellLayout.railWidth },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '今天' }} />
      <Tabs.Screen name="plans" options={{ title: '懒人装甲' }} />
      <Tabs.Screen name="create" options={{ href: null }} />
      <Tabs.Screen name="records" options={{ title: '记录' }} />
      <Tabs.Screen name="me" options={{ title: '我的' }} />
      <Tabs.Screen name="connections" options={{ title: '连接' }} />
      <Tabs.Screen name="domains" options={{ href: null }} />
      <Tabs.Screen name="permissions" options={{ href: null }} />
      <Tabs.Screen name="commerce" options={{ href: null }} />
    </Tabs>{pathname !== '/create' ? <Pressable accessibilityRole="button" accessibilityLabel="创建计划草稿" onPress={() => router.push('/create' as never)} style={[styles.aiEntry, { bottom: Math.max(insets.bottom + 12, 22) }]}><Ionicons name="add" size={20} color="#FFFFFF" /><Text style={styles.aiText}>创建计划</Text></Pressable> : null}</View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  aiEntry: { position: 'absolute', right: 14, minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: '#FF7A00', flexDirection: 'row', alignItems: 'center', gap: 6, shadowColor: '#B45800', shadowOpacity: 0.18, shadowRadius: 9, elevation: 5 },
  aiText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
