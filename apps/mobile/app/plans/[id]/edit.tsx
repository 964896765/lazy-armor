import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Button, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../../src/api';
import { useAuthStore } from '../../../src/auth-store';
import { workspaceColors as colors } from '../../../src/design';
import {
  buildInitialTemplateConfig,
  normalizeTemplateConfig,
  TemplateConfigForm,
  type TemplateConfigField,
  type TemplateConfigValues,
} from '../../../src/template-config-form';

interface PlanSummary {
  id: string;
  name: string | null;
  templateKey: string | null;
  currentVersion: { versionNumber: number } | null;
}

interface PlanVersionDetail {
  templateConfig: Record<string, unknown> | null;
}

interface TemplateDetail {
  name: string;
  configFields: TemplateConfigField[];
  defaultConfig: Record<string, unknown>;
}

export default function PlanEditPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const summary = useQuery({
    queryKey: ['plan', id, token],
    queryFn: () => api<PlanSummary>(`/plans/${id}`, token),
    enabled: Boolean(id && token),
  });
  const version = useQuery({
    queryKey: ['plan-version-edit', id, summary.data?.currentVersion?.versionNumber, token],
    queryFn: () => api<PlanVersionDetail>(`/plans/${id}/versions/${summary.data?.currentVersion?.versionNumber}`, token),
    enabled: Boolean(id && token && summary.data?.currentVersion?.versionNumber),
  });
  const template = useQuery({
    queryKey: ['template-detail', summary.data?.templateKey, token],
    queryFn: () => api<TemplateDetail>(`/templates/${summary.data?.templateKey}`, token),
    enabled: Boolean(token && summary.data?.templateKey),
  });
  const initialValues = useMemo(
    () => buildInitialTemplateConfig(template.data?.configFields ?? [], template.data?.defaultConfig, version.data?.templateConfig),
    [template.data, version.data],
  );
  const [values, setValues] = useState<TemplateConfigValues>({});

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const save = useMutation({
    mutationFn: () => api(`/templates/plans/${id}/version`, token, {
      method: 'POST',
      body: JSON.stringify({ config: normalizeTemplateConfig(template.data?.configFields ?? [], values) }),
    }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['plans', token] }),
        client.invalidateQueries({ queryKey: ['plan', id, token] }),
        client.invalidateQueries({ queryKey: ['plan-version', id] }),
      ]);
      router.replace(`/plans/${id}` as never);
    },
  });

  if (!token) {
    return (
      <ScrollView style={local.page} contentContainerStyle={local.content}>
        <View style={local.card}>
          <Text style={local.title}>请先登录</Text>
          <Button title="去登录" onPress={() => router.push('/connections')} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={local.page}
      contentContainerStyle={local.content}
      refreshControl={<RefreshControl refreshing={summary.isFetching || version.isFetching || template.isFetching} onRefresh={() => { void summary.refetch(); void version.refetch(); void template.refetch(); }} />}
    >
      {(summary.isLoading || version.isLoading || template.isLoading) && <ActivityIndicator />}
      {(summary.isError || version.isError || template.isError) && (
        <View style={local.card}>
          <Text style={local.title}>计划编辑页暂时加载失败</Text>
          <Button title="重新加载" onPress={() => { void summary.refetch(); void version.refetch(); void template.refetch(); }} />
        </View>
      )}
      {summary.data && template.data ? (
        <>
          <Text style={local.eyebrow}>计划编辑</Text>
          <Text style={local.title}>{summary.data.name ?? template.data.name}</Text>
          <Text style={local.subtitle}>修改后会生成一个新版本，不会覆盖已经存在的历史记录。</Text>
          <View style={local.card}>
            <Text style={local.cardTitle}>可编辑配置</Text>
            <TemplateConfigForm
              fields={template.data.configFields}
              values={values}
              onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
            />
          </View>
          <View style={local.card}>
            <Text style={local.text}>保存后只会更新当前草稿版本；如需正式运行，回到详情页再 Apply。</Text>
            <Button title={save.isPending ? '保存中…' : '保存为新版本'} onPress={() => save.mutate()} disabled={save.isPending} />
            {save.isError ? <Text style={local.error}>保存失败，请检查配置后重试。</Text> : null}
          </View>
        </>
      ) : null}
      {summary.data && !summary.data.templateKey ? (
        <View style={local.card}>
          <Text style={local.title}>当前计划暂不支持模板编辑</Text>
          <Text style={local.text}>这份计划不是从模板安装的，后续再补通用编辑器。</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const local = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 52 },
  eyebrow: { color: colors.success, fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '700', marginTop: 6 },
  subtitle: { color: colors.textSecondary, fontSize: 16, lineHeight: 24, marginTop: 8, marginBottom: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontWeight: '700', fontSize: 16, color: colors.textSecondary, marginBottom: 4 },
  text: { color: colors.textSecondary, lineHeight: 21 },
  error: { color: colors.danger, marginTop: 10 },
});
