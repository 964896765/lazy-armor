import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Button, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import {
  buildInitialTemplateConfig,
  normalizeTemplateConfig,
  TemplateConfigForm,
  type TemplateConfigField,
  type TemplateConfigValues,
} from '../../src/template-config-form';

interface TemplateDetail {
  key: string;
  domain: string;
  group: string;
  name: string;
  description: string;
  icon: string;
  templateVersion: string;
  status: string;
  automationLevel: string;
  requiredConnectors: string[];
  details: {
    doesWhat: string;
    runsWhen: string;
    dataNeeded: string;
    remindsWhen: string;
    connectionSummary: string;
    riskSummary: string;
  };
  configFields: TemplateConfigField[];
  defaultConfig: Record<string, unknown>;
}

export default function TemplateDetailPage() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['template-detail', key, token],
    queryFn: () => api<TemplateDetail>(`/templates/${key}`, token),
    enabled: Boolean(key && token),
  });
  const initialValues = useMemo(
    () => buildInitialTemplateConfig(detail.data?.configFields ?? [], detail.data?.defaultConfig, undefined),
    [detail.data],
  );
  const [values, setValues] = useState<TemplateConfigValues>({});

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const install = useMutation({
    mutationFn: () => api<{ id: string }>(`/templates/${key}/install`, token, {
      method: 'POST',
      body: JSON.stringify({ config: normalizeTemplateConfig(detail.data?.configFields ?? [], values) }),
    }),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans'] }),
        client.invalidateQueries({ queryKey: ['templates', token] }),
      ]);
      router.replace(`/plans/${result.id}` as never);
    },
  });

  if (!token) {
    return (
      <ScrollView style={local.page} contentContainerStyle={local.content}>
        <View style={local.card}>
          <Text style={local.title}>请先登录</Text>
          <Text style={local.text}>登录后才能查看模板详情并装上计划。</Text>
          <Button title="去登录" onPress={() => router.push('/connections')} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={local.page}
      contentContainerStyle={local.content}
      refreshControl={<RefreshControl refreshing={detail.isFetching} onRefresh={() => detail.refetch()} />}
    >
      {detail.isLoading && <ActivityIndicator />}
      {detail.isError && (
        <View style={local.card}>
          <Text style={local.title}>模板详情加载失败</Text>
          <Button title="重新加载" onPress={() => detail.refetch()} />
        </View>
      )}
      {detail.data && (
        <>
          <Text style={local.eyebrow}>懒人计划库</Text>
          <Text style={local.title}>{detail.data.icon} · {detail.data.name}</Text>
          <Text style={local.subtitle}>{detail.data.description}</Text>

          <View style={local.card}>
            <Text style={local.cardTitle}>模板信息</Text>
            <Text style={local.text}>分类：{detail.data.group} / {detail.data.domain}</Text>
            <Text style={local.text}>自动化等级：{detail.data.automationLevel}</Text>
            <Text style={local.text}>模板版本：V{detail.data.templateVersion}</Text>
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>它会替你做什么</Text>
            <Text style={local.text}>{detail.data.details.doesWhat}</Text>
            <Text style={local.cardTitle}>什么时候运行</Text>
            <Text style={local.text}>{detail.data.details.runsWhen}</Text>
            <Text style={local.cardTitle}>需要什么数据</Text>
            <Text style={local.text}>{detail.data.details.dataNeeded}</Text>
            <Text style={local.cardTitle}>什么时候会提醒</Text>
            <Text style={local.text}>{detail.data.details.remindsWhen}</Text>
            <Text style={local.cardTitle}>需要哪些连接</Text>
            <Text style={local.text}>{detail.data.details.connectionSummary}</Text>
            <Text style={local.cardTitle}>风险与确认</Text>
            <Text style={local.text}>{detail.data.details.riskSummary}</Text>
          </View>

          <View style={local.card}>
            <Text style={local.cardTitle}>安装前配置</Text>
            <TemplateConfigForm
              fields={detail.data.configFields}
              values={values}
              onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
            />
          </View>

          <View style={local.card}>
            <Text style={local.text}>装上后会生成一个正式 Plan Draft，之后还能继续修改阈值、周期和提醒方式。</Text>
            <Button title={install.isPending ? '装上中…' : '装上'} onPress={() => install.mutate()} disabled={install.isPending} />
            {install.isError ? <Text style={local.error}>装上失败，请检查配置后重试。</Text> : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EF' },
  content: { padding: 24, paddingTop: 52 },
  eyebrow: { color: '#287052', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#17251F', fontSize: 30, fontWeight: '800', marginTop: 8 },
  subtitle: { color: '#69756F', fontSize: 16, lineHeight: 24, marginTop: 8, marginBottom: 24 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E3E7E4' },
  cardTitle: { fontWeight: '700', fontSize: 16, color: '#24342C', marginTop: 10, marginBottom: 4 },
  text: { color: '#6B7770', lineHeight: 21 },
  error: { color: '#A63D3D', marginTop: 10 },
});
