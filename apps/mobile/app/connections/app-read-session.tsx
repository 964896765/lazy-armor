import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { appReadEventRequest, appReadHeartbeatRequest } from '../../src/app-read-session-api-contract';
import { useAuthStore } from '../../src/auth-store';
import {
  acknowledgeAppReadSessionEvents, appReadSessionStatus, drainAppReadSessionEvents,
  openUsageAccessSettings, startNativeAppReadSession, stopNativeAppReadSession,
} from '../../src/device-app-bridge';
import { ActionButton, EmptyState, Surface, colors, radius, spacing, typography } from '../../src/design';
import { deviceBoundApi, ensureTrustedDevice } from '../../src/trusted-device-api';

interface AppReadSession {
  id: string; connectionId: string; targetPackage: string; modes: string[]; status: string;
  startedAt: string | null; lastHeartbeatAt: string | null; expiresAt: string; endedAt: string | null;
  terminalReason: string | null; events: Array<{ id: string; eventKey: string; eventType: string; sourceMode: string | null; candidateFactId: string | null; createdAt: string }>;
}

export default function AppReadSessionPage() {
  const params = useLocalSearchParams<{ connectionId?: string; packageName?: string; displayName?: string; notificationEnabled?: string }>();
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const current = useQuery({
    queryKey: ['app-read-session', token],
    queryFn: () => api<AppReadSession | null>('/app-read-sessions/current', token),
    enabled: Boolean(token), staleTime: 0,
  });
  const native = useQuery({ queryKey: ['native-app-read-session'], queryFn: appReadSessionStatus, staleTime: 0 });

  const sync = useMutation({
    mutationFn: async () => syncNativeEvents(token, current.data?.id ?? null),
    onSuccess: async () => {
      await Promise.all([current.refetch(), native.refetch(), client.invalidateQueries({ queryKey: ['mobile-notification-receipts', token] })]);
    },
  });
 useFocusEffect(useCallback(() => { void sync.mutateAsync().catch(() => undefined); }, []));

  const start = useMutation({
    mutationFn: async () => {
      if (!token || !params.connectionId || !params.packageName) throw new Error('missing_connection');
      await ensureTrustedDevice(token);
      const modes = params.notificationEnabled === 'true' ? ['NOTIFICATION', 'SHARE'] : ['SHARE'];
      const body = { connectionId: params.connectionId, targetPackage: params.packageName, modes, durationSeconds: 300 };
      const session = await deviceBoundApi<AppReadSession>('/app-read-sessions', token, { method: 'POST', body: JSON.stringify(body) });
      if (!await startNativeAppReadSession(session.id, session.targetPackage, session.modes, session.expiresAt)) throw new Error('native_start_failed');
      return session;
    },
    onSuccess: async () => { await Promise.all([current.refetch(), native.refetch()]); },
  });

  const stop = useMutation({
    mutationFn: async () => {
      if (!token || !current.data) return null;
      await stopNativeAppReadSession();
      return deviceBoundApi<AppReadSession>('/app-read-sessions/' + current.data.id + '/stop', token, { method: 'POST', body: '{}' });+    },
    onSuccess: async () => { await Promise.all([current.refetch(), native.refetch()]); },+  });
