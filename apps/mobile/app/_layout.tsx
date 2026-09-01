import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../src/auth-store';

export default function RootLayout() {
  const [client] = useState(() => new QueryClient());
  const hydrate = useAuthStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return <QueryClientProvider client={client}><Stack><Stack.Screen name="(tabs)" options={{ headerShown: false }} /><Stack.Screen name="connections" options={{ title: '我的连接' }} /><Stack.Screen name="executions/[id]" options={{ title: '执行详情' }} /><Stack.Screen name="templates/[key]" options={{ title: '模板详情' }} /><Stack.Screen name="plans/[id]" options={{ title: '计划详情' }} /><Stack.Screen name="plans/[id]/edit" options={{ title: '编辑计划' }} /></Stack></QueryClientProvider>;
}
