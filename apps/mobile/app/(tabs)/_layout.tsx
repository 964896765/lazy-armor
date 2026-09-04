import { Tabs } from 'expo-router';
import { ConnectionRail, shellLayout } from '../../src/lazy-armor-shell';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <ConnectionRail {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: 'left',
        sceneStyle: { marginLeft: shellLayout.railWidth },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '消息' }} />
      <Tabs.Screen name="plans" options={{ title: '懒人装甲' }} />
      <Tabs.Screen name="create" options={{ href: null }} />
      <Tabs.Screen name="records" options={{ href: null }} />
      <Tabs.Screen name="me" options={{ href: null }} />
    </Tabs>
  );
}
