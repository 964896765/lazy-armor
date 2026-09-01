import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { automationLevelLabel } from '../../src/plan-presenter';
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

interface NaturalLanguageSuggestion {
  adapter: string;
  template: {
    key: string;
    name: string;
    description: string;
    icon: string;
  };
  reason: string;
  config: Record<string, unknown>;
  humanSummary: string;
  canInstallDirectly: boolean;
  missingFields: Array<{ key: string; label: string }>;
  matchedKeywords: string[];
}

export default function Create() {
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const [intent, setIntent] = useState('');
  const templates = useQuery({
    queryKey: ['templates', token],
    queryFn: () => api<PlanTemplateSummary[]>('/templates', token),
    enabled: Boolean(token),
  });
  const parseIntent = useMutation({
    mutationFn: () => api<NaturalLanguageSuggestion>('/templates/natural-language/parse', token, {
      method: 'POST',
      body: JSON.stringify({ query: intent.trim() }),
    }),
  });
  const installIntent = useMutation({
    mutationFn: () => api<{ id: string }>('/templates/natural-language/install', token, {
      method: 'POST',
      body: JSON.stringify({ query: intent.trim() }),
    }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ['plans', token] });
      router.push(`/plans/${result.id}` as never);
    },
  });

  return (
    <ScrollView
      style={local.page}
      contentContainerStyle={local.content}
      refreshControl={token ? <RefreshControl refreshing={templates.isFetching} onRefresh={() => templates.refetch()} /> : undefined}
    >
      <Text style={styles.eyebrow}>懒人装甲 · P1</Text>
      <Text style={styles.title}>你今天想偷个什么懒？</Text>
      <Text style={styles.subtitle}>可以直接说一句人话，也可以继续从懒人计划库里挑一个 Canonical Plan。</Text>
      {!token ? (
        <View style={styles.card}><Text style={styles.cardTitle}>请先登录</Text><Button title="去登录" onPress={() => router.push('/connections')} /></View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>A. 想偷什么懒</Text>
            <Text style={styles.cardText}>例如：“以后每个月话费超过 150 块再告诉我。”</Text>
            <TextInput
              style={local.input}
              multiline
              numberOfLines={3}
              placeholder="用一句话描述你想省掉的事"
              value={intent}
              onChangeText={setIntent}
            />
            <View style={local.button}>
              <Button
                title={parseIntent.isPending ? '识别中…' : '帮我理解这句话'}
                onPress={() => parseIntent.mutate()}
                disabled={parseIntent.isPending || !intent.trim()}
              />
            </View>
            {parseIntent.isError ? <Text style={local.error}>暂时还没理解这句话，请把场景、条件和结果说得更具体一点。</Text> : null}
          </View>

          {parseIntent.data ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{parseIntent.data.template.icon} · 推荐给你</Text>
              <Text style={styles.cardText}>{parseIntent.data.template.name}</Text>
              <Text style={styles.cardText}>{parseIntent.data.humanSummary}</Text>
              <Text style={styles.cardText}>判断依据：{parseIntent.data.reason}</Text>
              {parseIntent.data.matchedKeywords.length > 0 ? (
                <Text style={styles.cardText}>识别到的关键词：{parseIntent.data.matchedKeywords.join('、')}</Text>
              ) : null}
              {parseIntent.data.missingFields.length > 0 ? (
                <Text style={styles.cardText}>还需要你补充：{parseIntent.data.missingFields.map((field) => field.label).join('、')}</Text>
              ) : null}
              {parseIntent.data.canInstallDirectly ? (
                <View style={local.button}>
                  <Button
                    title={installIntent.isPending ? '生成草稿中…' : '直接生成草稿'}
                    onPress={() => installIntent.mutate()}
                    disabled={installIntent.isPending}
                  />
                </View>
              ) : null}
              <View style={local.button}>
                <Button
                  title={parseIntent.data.canInstallDirectly ? '查看并微调模板' : '继续补充配置'}
                  onPress={() => router.push(`/templates/${parseIntent.data.template.key}?draft=${encodeURIComponent(JSON.stringify(parseIntent.data.config))}` as never)}
                />
              </View>
              {installIntent.isError ? <Text style={local.error}>草稿生成失败，请先进入模板页补充缺少的信息。</Text> : null}
            </View>
          ) : null}

          <Text style={local.sectionTitle}>B. 懒人计划库</Text>
          {templates.isError && <Text style={local.error}>模板读取失败，请稍后重试。</Text>}
          {templates.data?.map((template) => (
            <Pressable key={template.key} onPress={() => router.push(`/templates/${template.key}` as never)}>
              <View style={styles.card}>
                <View style={local.headingRow}>
                  <Text style={styles.cardTitle}>{template.icon} · {template.name}</Text>
                  <Text style={local.level}>{automationLevelLabel(template.automationLevel)}</Text>
                </View>
                <Text style={styles.cardText}>{template.description}</Text>
                <Text style={styles.cardText}>分类：{template.group}</Text>
                <Text style={styles.cardText}>连接情况：{connectorSummary(template.requiredConnectors)}</Text>
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

function connectorSummary(requiredConnectors: string[]) {
  if (requiredConnectors.length === 0) return '现在就能装上';
  if (requiredConnectors.every((item) => item === 'manual' || item === 'internal')) return '先用你提供的信息或系统已有信息';
  return '后续会用到外部连接';
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { padding: 24, paddingTop: 52 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  level: { color: '#287052', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#FAFBFA', marginTop: 12, textAlignVertical: 'top' },
  button: { marginTop: 18 },
  sectionTitle: { color: '#17251F', fontSize: 20, fontWeight: '800', marginTop: 8, marginBottom: 12 },
  error: { color: '#A63D3D', marginTop: 10 },
});
