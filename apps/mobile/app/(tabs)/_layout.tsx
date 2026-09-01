import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerTitleStyle: { fontWeight: '700' }, tabBarActiveTintColor: '#256047' }}>
      <Tabs.Screen name="index" options={{ title: '今天' }} />
      <Tabs.Screen name="plans" options={{ title: '计划' }} />
      <Tabs.Screen name="create" options={{ title: '＋' }} />
      <Tabs.Screen name="records" options={{ title: '记录' }} />
      <Tabs.Screen name="me" options={{ title: '我的' }} />
    </Tabs>
  );
}
