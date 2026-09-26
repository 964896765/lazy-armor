import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { GlobalActionBar, TopWorkspaceNav } from '../../src/v6-shell';

export default function TabsLayout() {
  return (
    <View style={styles.container}>
      <TopWorkspaceNav />
      <View style={styles.scene}>
        <Tabs initialRouteName="index" tabBar={() => null} screenOptions={{ headerShown: false }}>
          <Tabs.Screen name="index" options={{ title: '首页' }} />
          <Tabs.Screen name="plans" options={{ title: '计划' }} />
          <Tabs.Screen name="private" options={{ href: null }} />
          <Tabs.Screen name="commerce" options={{ href: null }} />
          <Tabs.Screen name="messages" options={{ href: null }} />
          <Tabs.Screen name="search-ai" options={{ href: null }} />
          <Tabs.Screen name="todo" options={{ href: null }} />
          <Tabs.Screen name="scenarios" options={{ href: null }} />
          <Tabs.Screen name="create" options={{ href: null }} />
          <Tabs.Screen name="records" options={{ href: null }} />
          <Tabs.Screen name="me" options={{ href: null }} />
          <Tabs.Screen name="connections" options={{ href: null }} />
          <Tabs.Screen name="domains" options={{ href: null }} />
          <Tabs.Screen name="permissions" options={{ href: null }} />
        </Tabs>
      </View>
      <GlobalActionBar />
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 }, scene: { flex: 1 } });
