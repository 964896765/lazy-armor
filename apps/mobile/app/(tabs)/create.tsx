import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Button, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { styles } from '../../src/shell';

interface PlanTemplateSummary {
  key: string;
  domain: string;
  group: string;
  name: string;
  description: string;
  icon: string;
  automationLevel: string;
  requiredConnectors: string[];
}

export default function Create() {
  const token = useAuthStore((state) => state.token);
  const templates = useQuery({
    queryKey: ['templates', token],
    queryFn: () => api<PlanTemplateSummary[]>('/templates', token),
    enabled: Boolean(token),
  });

  return (
    <ScrollView
      style={local.page}
      contentContainerStyle={local.content}
      refreshControl={token ? <RefreshControl refreshing={templates.isFetching} onRefresh={() => templates.refetch()} /> : undefined}
    >
      <Text style={styles.eyebrow}>懒人装甲 · P1</Text>
      <Text style={styles.title}>懒人计划库</Text>
      <Text style={styles.subtitle}>你今天想偷个什么懒？先装上一个 Canonical Plan，生成可配置的计划草稿。</Text>
      {!token ? (
        <View style={styles.card}><Text style={styles.cardTitle}>请先登录</Text><Button title="去登录" onPress={() => router.push('/connections')} /></View>
      ) : (
        <>
          {templates.isError && <Text style={local.error}>模板读取失败，请稍后重试。</Text>}
          {templates.data?.map((template) => (
            <Pressable key={template.key} onPress={() => router.push(`/templates/${template.key}` as never)}>
              <View style={styles.card}>
                <View style={local.headingRow}>
                  <Text style={styles.cardTitle}>{template.icon} · {template.name}</Text>
                  <Text style={local.level}>{template.automationLevel}</Text>
                </View>
                <Text style={styles.cardText}>{template.description}</Text>
                <Text style={styles.cardText}>分类：{template.group} / {template.domain}</Text>
                <Text style={styles.cardText}>可接来源：{template.requiredConnectors.join(' / ')}</Text>
                <View style={local.button}>
                  <Button title="查看详情" onPress={() => router.push(`/templates/${template.key}` as never)} />
                </View>
              </View>
            </Pressable>
          ))}
          {templates.data?.length === 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>计划库准备中</Text>
              <Text style={styles.cardText}>模板目录已挂载，稍后会继续扩展到更多领域。</Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { padding: 24, paddingTop: 52 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  level: { color: '#287052', fontWeight: '700' },
  button: { marginTop: 18 },
  error: { color: '#A63D3D', marginTop: 10 },
});
