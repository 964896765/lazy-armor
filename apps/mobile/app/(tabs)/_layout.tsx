import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ConnectionRail, shellLayout } from '../../src/lazy-armor-shell';

export default function TabsLayout() {
  return (
    <View style={styles.container}><Tabs
      tabBar={(props) => <ConnectionRail {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: 'left',
        sceneStyle: { marginLeft: shellLayout.railWidth },
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
    </Tabs></View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 } });
