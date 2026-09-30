import { Ionicons } from '@expo/vector-icons';
import { useQueries, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { workspaceColors as colors, radius, spacing, typography } from '../src/design';

type Category = '全部' | '技能' | 'MCP' | 'API';
interface Connection { id: string; connectorName: string }
interface Capability { key: string; name: string; usable: boolean; reasons: string[] }
interface CapabilityResponse { capabilities: Capability[] }

export default function CapabilitiesPage() {
  const token = useAuthStore((state) => state.token);
  const [category, setCategory] = useState<Category>('全部');
  const connections = useQuery({ queryKey: ['capability-connections', token], queryFn: () => api<Connection[]>('/connections', token), enabled: Boolean(token) });
  const details = useQueries({ queries: (connections.data ?? []).map((connection) => ({ queryKey: ['connection-capabilities', connection.id], queryFn: () => api<CapabilityResponse>(`/connections/${connection.id}/capabilities`, token), enabled: Boolean(token) })) });
  const rows = (connections.data ?? []).flatMap((connection, index) => (details[index]?.data?.capabilities ?? []).map((capability) => ({ ...capability, connection })));
  const visible = rows.filter((row) => category === '全部' || (category === 'MCP' ? /mcp/i.test(row.key) : category === 'API' ? /api/i.test(row.key) : !/mcp|api/i.test(row.key)));
  const categories: Category[] = ['全部', '技能', 'MCP', 'API'];
  return <SafeAreaView edges={['top']} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><View><Text style={styles.title}>能力与扩展</Text><Text style={styles.subtitle}>扩展我的能力，让我能执行更复杂的任务。</Text></View></View>
    <View style={styles.tabs}>{categories.map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: category === item }} onPress={() => setCategory(item)} style={[styles.tab, category === item && styles.selectedTab]}><Text style={[styles.tabText, category === item && styles.selectedText]}>{item}{item === '全部' || item === '技能' ? ` ${item === '全部' ? rows.length : rows.filter((row) => !/mcp|api/i.test(row.key)).length}` : ''}</Text></Pressable>)}</View>
    <Text style={styles.heading}>已启用的能力</Text>
    {connections.isLoading || details.some((item) => item.isLoading) ? <ActivityIndicator color={colors.primary} /> : null}
    {connections.isError || details.some((item) => item.isError) ? <Text style={styles.empty}>暂时无法核对能力，请稍后重试。</Text> : null}
    {visible.length > 0 ? <View style={styles.list}>{visible.map((row, index) => <Pressable key={`${row.connection.id}:${row.key}`} onPress={() => router.push(`/connections/${row.connection.id}` as never)} style={[styles.row, index < visible.length - 1 && styles.divider]}><View style={styles.icon}><Ionicons name="flash-outline" size={18} color={colors.brand} /></View><View style={styles.copy}><Text style={styles.rowTitle}>{row.name}</Text><Text numberOfLines={1} style={styles.rowDetail}>{row.connection.connectorName} · {row.usable ? '当前可用' : row.reasons.length ? '条件尚未满足' : '待核对'}</Text></View><Text style={[styles.badge, row.usable && styles.ready]}>{row.usable ? '已启用' : '未启用'}</Text></Pressable>)}</View> : !connections.isLoading && !details.some((item) => item.isLoading) && !connections.isError ? <Text style={styles.empty}>当前分类还没有已核实的能力。连接资源后会在这里显示真实状态。</Text> : null}
    <Text style={styles.heading}>扩展</Text>
    {([['技能', '按任务需要使用已连接的能力', 'sparkles-outline'], ['MCP', '查看已连接来源提供的 MCP 能力', 'cube-outline'], ['API', '查看已连接来源提供的 API 能力', 'code-slash-outline']] as const).map(([title, detail, icon]) => <Pressable key={title} onPress={() => setCategory(title)} style={styles.extension}><View style={styles.icon}><Ionicons name={icon} size={18} color={colors.brand} /></View><View style={styles.copy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>)}
    <Pressable onPress={() => router.push('/connections/add' as never)} style={styles.add}><Ionicons name="add" size={19} color={colors.text} /><Text style={styles.addText}>添加资源以扩展能力</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 56 },
  header: { marginBottom: spacing.lg }, title: { ...typography.pageTitle, color: colors.text }, subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  tabs: { flexDirection: 'row', gap: 5 }, tab: { flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accentSoft }, selectedTab: { backgroundColor: colors.text }, tabText: { ...typography.caption, color: colors.textSecondary }, selectedText: { color: '#FFF' },
  heading: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm }, list: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: spacing.sm, gap: spacing.sm }, divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, icon: { width: 34, height: 34, backgroundColor: colors.accentSoft, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, minWidth: 0 }, rowTitle: { ...typography.bodyStrong, color: colors.text }, rowDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, badge: { ...typography.label, color: colors.textMuted }, ready: { color: colors.success }, empty: { ...typography.caption, color: colors.textSecondary, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg },
  extension: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: spacing.sm, paddingHorizontal: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: 5 }, add: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, marginTop: spacing.lg }, addText: { ...typography.bodyStrong, color: colors.text },
});
