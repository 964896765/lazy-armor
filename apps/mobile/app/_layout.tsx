import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../src/auth-store';
import { colors } from '../src/design';

export default function RootLayout() {
  const [client] = useState(() => new QueryClient());
  const hydrate = useAuthStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerStyle: { backgroundColor: colors.background }, headerShadowVisible: false, headerTintColor: colors.primary, headerTitleStyle: { color: colors.text, fontWeight: '700' } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="membership" options={{ title: '会员' }} />
        <Stack.Screen name="connections" options={{ title: '我的连接' }} />
        <Stack.Screen name="permissions" options={{ title: '权限中心' }} />
        <Stack.Screen name="devices" options={{ title: '我的设备' }} />
        <Stack.Screen name="vehicles" options={{ title: '我的车辆' }} />
        <Stack.Screen name="notification-settings" options={{ title: '通知' }} />
        <Stack.Screen name="automation-safety" options={{ title: '自动化安全等级' }} />
        <Stack.Screen name="data-management" options={{ title: '数据管理' }} />
        <Stack.Screen name="security-activity" options={{ title: '安全记录' }} />
        <Stack.Screen name="oauth/callback" options={{ title: '连接服务' }} />
        <Stack.Screen name="file-import" options={{ title: '导入账单文件' }} />
        <Stack.Screen name="executions/[id]" options={{ title: '执行详情' }} />
        <Stack.Screen name="templates/[key]" options={{ title: '模板详情' }} />
        <Stack.Screen name="plans/[id]" options={{ title: '计划详情' }} />
        <Stack.Screen name="plans/[id]/edit" options={{ title: '编辑计划' }} />
      </Stack>
    </QueryClientProvider>
  );
}
