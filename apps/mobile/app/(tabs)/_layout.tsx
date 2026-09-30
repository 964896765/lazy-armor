import { Tabs, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AssistantInputBar, GlobalActionBar, TopWorkspaceNav } from '../../src/v6-shell';
import { isSecondaryWorkspacePath } from '../../src/information-architecture';

export default function TabsLayout() {
  const pathname = usePathname();
  const secondaryPage = isSecondaryWorkspacePath(pathname);
  const showAssistantBar = !secondaryPage && pathname === '/plans';
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  return (
    <View style={styles.container}>
      <SafeAreaView edges={secondaryPage ? [] : ['top']} style={styles.scene}>
        <Tabs
          initialRouteName="index"
          tabBar={() => null}
          screenOptions={{ headerShown: false, sceneStyle: styles.transparentScene }}
        >
          <Tabs.Screen name="index" options={{ title: '首页' }} />
          <Tabs.Screen name="plans" options={{ title: '计划' }} />
          <Tabs.Screen name="private" options={{ href: null }} />
          <Tabs.Screen name="services" options={{ href: null }} />
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
      </SafeAreaView>
      {!secondaryPage ? <TopWorkspaceNav /> : null}
      {showAssistantBar ? <AssistantInputBar /> : null}
      {!secondaryPage && !(pathname === '/search-ai' && keyboardVisible) ? <GlobalActionBar /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scene: { flex: 1 },
  transparentScene: { backgroundColor: 'transparent' },
});
