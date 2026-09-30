import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { AuthGate } from '../src/auth-gate';
import { useAuthStore } from '../src/auth-store';
import { useAuthSessionRefresh } from '../src/auth-session-refresh';
import { colors, typography } from '../src/design';
import { useDeviceTaskRunnerLifecycle } from '../src/device-task-lifecycle-hook';

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: 0, staleTime: 10_000, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  }));
  const hydrate = useAuthStore((state) => state.hydrate);
  useAuthSessionRefresh();
  useDeviceTaskRunnerLifecycle();
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <QueryClientProvider client={client}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <AuthGate>
        <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerStyle: { backgroundColor: colors.background }, headerShadowVisible: false, headerTintColor: colors.primary, headerTitleStyle: { color: colors.text, ...typography.navigationTitle } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="membership" options={{ headerShown: false }} />
          <Stack.Screen name="connections/add" options={{ headerShown: false }} />
          <Stack.Screen name="connections/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="apps/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="approvals" options={{ headerShown: false }} />
          <Stack.Screen name="approvals/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="attention" options={{ headerShown: false }} />
          <Stack.Screen name="plan-center" options={{ headerShown: false }} />
          <Stack.Screen name="connections/trusted-devices" options={{ headerShown: false }} />
          <Stack.Screen name="connections/notification-sources" options={{ title: '通知来源' }} />
          <Stack.Screen name="truth-store" options={{ title: '已验证事实' }} />
          <Stack.Screen name="domains/[domain]" options={{ headerShown: false }} />
          <Stack.Screen name="domains/[domain]/[scenario]" options={{ headerShown: false }} />
          <Stack.Screen name="connections/[id]/capabilities/[key]" options={{ headerShown: false }} />
          <Stack.Screen name="devices" options={{ headerShown: false }} />
          <Stack.Screen name="vehicles" options={{ headerShown: false }} />
          <Stack.Screen name="notification-settings" options={{ headerShown: false }} />
          <Stack.Screen name="automation-safety" options={{ headerShown: false }} />
          <Stack.Screen name="security-center" options={{ headerShown: false }} />
          <Stack.Screen name="data-management" options={{ headerShown: false }} />
          <Stack.Screen name="security-activity" options={{ headerShown: false }} />
          <Stack.Screen name="privacy-center" options={{ headerShown: false }} />
          <Stack.Screen name="privacy-center/ai" options={{ headerShown: false }} />
          <Stack.Screen name="privacy-center/data" options={{ headerShown: false }} />
          <Stack.Screen name="privacy-center/permissions" options={{ headerShown: false }} />
          <Stack.Screen name="profile" options={{ headerShown: false }} />
          <Stack.Screen name="change-password" options={{ headerShown: false }} />
          <Stack.Screen name="oauth/callback" options={{ title: '连接服务' }} />
          <Stack.Screen name="file-import" options={{ title: '导入账单文件' }} />
          <Stack.Screen name="executions/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="executions/[id]/lifecycle" options={{ headerShown: false }} />
          <Stack.Screen name="reconciliation/index" options={{ headerShown: false }} />
          <Stack.Screen name="reconciliation/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="templates/index" options={{ headerShown: false }} />
          <Stack.Screen name="templates/[key]" options={{ title: '模板详情' }} />
          <Stack.Screen name="plans/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="plans/[id]/lifecycle" options={{ headerShown: false }} />
          <Stack.Screen name="strategies/index" options={{ headerShown: false }} />
          <Stack.Screen name="strategies/[strategy]" options={{ headerShown: false }} />
          <Stack.Screen name="truth/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="evidence/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="devices/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="plans/[id]/edit" options={{ title: '编辑计划' }} />
          <Stack.Screen name="connections/app-read-session" options={{ headerShown: false }} />
          <Stack.Screen name="connections/device-tasks/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="create-wizard" options={{ headerShown: false }} />
          <Stack.Screen name="feature-placeholder" options={{ headerShown: false }} />
          <Stack.Screen name="private-space" options={{ headerShown: false }} />
        </Stack>
      </AuthGate>
    </QueryClientProvider>
  );
}
