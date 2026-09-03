import { Tabs } from 'expo-router';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import { colors, spacing, typography } from '../../src/design';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: styles.tabBar,
      tabBarLabelStyle: styles.label,
      tabBarItemStyle: styles.item,
    }}>
      <Tabs.Screen name="index" options={{ title: '今天', tabBarIcon: ({ color }) => <TabIcon symbol="⌂" color={color} /> }} />
      <Tabs.Screen name="plans" options={{ title: '计划', tabBarIcon: ({ color }) => <TabIcon symbol="◇" color={color} /> }} />
      <Tabs.Screen name="create" options={{ title: '', tabBarIcon: () => <View style={styles.create}><Text style={styles.createText}>＋</Text></View> }} />
      <Tabs.Screen name="records" options={{ title: '记录', tabBarIcon: ({ color }) => <TabIcon symbol="◷" color={color} /> }} />
      <Tabs.Screen name="me" options={{ title: '我的', tabBarIcon: ({ color }) => <TabIcon symbol="○" color={color} /> }} />
    </Tabs>
  );
}

function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={[styles.icon, { color }]}>{symbol}</Text>;
}

const styles = StyleSheet.create({
  tabBar: { height: 76, paddingTop: spacing.sm, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderTopColor: colors.border },
  item: { paddingVertical: 2 },
  label: { ...typography.caption, fontSize: 11, fontWeight: '600' },
  icon: { fontSize: 21, lineHeight: 23 },
  create: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  createText: { color: colors.surface, fontSize: 29, lineHeight: 31, fontWeight: '300' },
});
