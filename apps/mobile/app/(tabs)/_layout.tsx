import { Tabs, usePathname } from 'expo-router';
import { Keyboard, StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';
import { GlobalActionBar } from '../../src/v6-shell';
import { isSecondaryWorkspacePath } from '../../src/information-architecture';

export default function TabsLayout() {
  const pathname = usePathname();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  const secondaryPage = isSecondaryWorkspacePath(pathname);
  return (
    <View style={styles.container}>
      <View style={styles.scene}>
        <Tabs initialRouteName="index" tabBar={() => null} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}>
          <Tabs.Screen name="index" options={{ href: null }} />
          <Tabs.Screen name="schedule" options={{ title: '日程' }} />
          <Tabs.Screen name="resources" options={{ href: null }} />
          <Tabs.Screen name="plans" options={{ title: '计划' }} />
          <Tabs.Screen name="private" options={{ href: null }} />
          <Tabs.Screen name="services" options={{ href: null }} />
          <Tabs.Screen name="commerce" options={{ href: null }} />
          <Tabs.Screen name="messages" options={{ href: null }} />
          <Tabs.Screen name="search-ai" options={{ href: null }} />
          <Tabs.Screen name="chat" options={{ href: null }} />
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
      {!secondaryPage && !keyboardVisible ? <GlobalActionBar /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 }, scene: { flex: 1 } });
