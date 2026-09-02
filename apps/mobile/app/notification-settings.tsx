import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { ShellPage, styles } from '../src/shell';

interface Settings {
  notifications: {
    importantExceptionImmediately: boolean;
    regularSummary: boolean;
    silentSuccess: boolean;
    dailySummaryTime: string;
  };
}

export default function NotificationSettingsPage() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['me-settings', token], queryFn: () => api<Settings>('/me/settings', token), enabled: Boolean(token) });
  const [importantExceptionImmediately, setImportantExceptionImmediately] = useState(true);
  const [regularSummary, setRegularSummary] = useState(true);
  const [silentSuccess, setSilentSuccess] = useState(true);
  const [dailySummaryTime, setDailySummaryTime] = useState('08:00');

  useEffect(() => {
    if (!settings.data) return;
    setImportantExceptionImmediately(settings.data.notifications.importantExceptionImmediately);
    setRegularSummary(settings.data.notifications.regularSummary);
    setSilentSuccess(settings.data.notifications.silentSuccess);
    setDailySummaryTime(settings.data.notifications.dailySummaryTime);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api('/me/settings', token, {
      method: 'PATCH',
      body: JSON.stringify({ notifications: { importantExceptionImmediately, regularSummary, silentSuccess, dailySummaryTime } }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['me-settings', token] }),
  });

  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="通知" subtitle="只保留最必要的偏好：重要异常、普通摘要、成功静默和每日摘要时间。">
        {settings.isLoading && <ActivityIndicator />}
        <View style={styles.card}>
          <Row label="重要异常立即提醒" value={importantExceptionImmediately} setValue={setImportantExceptionImmediately} />
          <Row label="普通事项摘要" value={regularSummary} setValue={setRegularSummary} />
          <Row label="正常成功保持静默" value={silentSuccess} setValue={setSilentSuccess} />
          <Text style={local.label}>每日摘要时间</Text>
          <TextInput style={local.input} value={dailySummaryTime} onChangeText={setDailySummaryTime} placeholder="08:00" />
          <Button title={save.isPending ? '保存中…' : '保存设置'} onPress={() => save.mutate()} disabled={save.isPending} />
        </View>
      </ShellPage>
    </ScrollView>
  );
}

function Row({ label, value, setValue }: { label: string; value: boolean; setValue: (next: boolean) => void }) {
  return <View style={local.row}><Text style={local.label}>{label}</Text><Switch value={value} onValueChange={setValue} /></View>;
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  label: { color: '#24342C', fontWeight: '600', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 10, padding: 12, marginBottom: 12, backgroundColor: '#FAFBFA' },
});
