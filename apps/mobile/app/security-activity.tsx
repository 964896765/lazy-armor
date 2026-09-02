import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { ShellPage, styles } from '../src/shell';

interface SecurityActivity {
  id: string;
  type: string;
  title: string;
  summary: string;
  status: string;
  createdAt: string;
}

export default function SecurityActivityPage() {
  const token = useAuthStore((state) => state.token);
  const activity = useQuery({ queryKey: ['security-activity', token], queryFn: () => api<SecurityActivity[]>('/security-activity', token), enabled: Boolean(token) });
  return (
    <ScrollView style={local.page} contentContainerStyle={local.content}>
      <ShellPage title="安全记录" subtitle="这里只展示对你有意义的重要安全事实，不直接暴露底层审计 JSON。">
        {activity.isLoading && <ActivityIndicator />}
        {activity.data?.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardText}>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.summary}</Text>
          </View>
        ))}
      </ShellPage>
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { paddingBottom: 20 },
});
