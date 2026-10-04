import { useQuery } from '@tanstack/react-query';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useRuntimeSettings, completeAcquisitionAuthorization, type RuntimeSettingKey } from '../src/runtime-settings';
import type { ComponentProps } from 'react';
import { AppState, Switch, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type IconName = ComponentProps<typeof Ionicons>['name'];
const ITEMS: Array<{ icon: IconName; color: string; background: string; title: string; detail: string; route: string }> = [
  { icon: 'radio-outline', color: '#3974E9', background: 'rgba(225,235,255,0.82)', title: '消息获取', detail: '管理手机通知、短信、日历等信息读取', route: '/connections/notification-sources' },
  { icon: 'notifications-outline', color: '#E5484D', background: 'rgba(255,229,232,0.80)', title: '消息通知', detail: '管理懒人装甲的通知提醒', route: '/notification-settings' },
  { icon: 'sync-outline', color: '#309B67', background: 'rgba(222,243,232,0.82)', title: '后台服务', detail: '保持连接与计划运行', route: '/connections/device-tasks' },
  { icon: 'phone-portrait-outline', color: '#7255D9', background: 'rgba(235,227,255,0.82)', title: '设备', detail: '管理本账号登录的设备', route: '/connected-devices' },
];

export default function SettingsPage() {
  const token = useAuthStore(s => s.token); const ai = useQuery({ queryKey: ['ai-service', token], queryFn: () => api<{ configured: boolean }>('/ai-service', token), enabled: Boolean(token) });
  const settings = useRuntimeSettings(); const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const awaiting = useRef(false);
  useEffect(() => { settings.refresh().catch(e => setError(e.message)); const sub = AppState.addEventListener('change', state => { if (state === 'active') { const work = awaiting.current ? completeAcquisitionAuthorization() : settings.refresh(); awaiting.current = false; work.catch(e => setError(e.message)); } }); return () => sub.remove(); }, []);
  async function toggle(key: RuntimeSettingKey, value: boolean) { setBusy(key); setError(''); try { awaiting.current = key === 'acquisition' && value; await settings.toggle(key, value); } catch (e) { awaiting.current = false; setError(e instanceof Error ? e.message : '设置失败，请重试'); } finally { setBusy(''); } }
  return <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.canGoBack() ? router.back() : router.replace('/' as never)} style={styles.headerButton}><Ionicons name="chevron-back" size={25} color="#172033" /></Pressable><Text style={styles.headerTitle}>设置</Text><View style={styles.headerButton} /></View>
    <View style={styles.list}>{ITEMS.map((item) => <Pressable key={item.title} accessibilityRole="button" onPress={item.title === '设备' ? () => router.push(item.route as never) : undefined} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><View style={[styles.icon, { backgroundColor: item.background }]}><Ionicons name={item.icon} size={27} color={item.color} /></View><View style={styles.copy}><Text style={styles.title}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text></View><View>{item.title === '设备' ? <Ionicons name="chevron-forward" size={21} color="#526178" /> : <Switch accessibilityLabel={item.title} disabled={!settings.ready || Boolean(busy)} value={settings[({ '消息获取': 'acquisition', '消息通知': 'notifications', '后台服务': 'background' } as Record<string, RuntimeSettingKey>)[item.title]]} onValueChange={value => void toggle(({ '消息获取': 'acquisition', '消息通知': 'notifications', '后台服务': 'background' } as Record<string, RuntimeSettingKey>)[item.title], value)} trackColor={{ true: '#3083FF' }} />}</View></Pressable>)}</View>
<Pressable style={[styles.row, { marginTop: 12 }]} onPress={() => router.push('/ai-service' as never)}><View style={[styles.icon, { backgroundColor: '#E9E6FF' }]}><Ionicons name="sparkles-outline" size={27} color="#7255D9" /></View><View style={styles.copy}><Text style={styles.title}>AI 服务</Text><Text style={styles.detail}>DeepSeek · {!token ? '登录后配置' : ai.isError ? '读取失败' : ai.isLoading ? '读取中' : ai.data?.configured ? '已配置' : '未配置'}</Text></View><Ionicons name="chevron-forward" size={21} color="#526178" /></Pressable>
    {error ? <Text style={{ color: '#D34050', marginTop: 14 }}>{error}</Text> : null}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'transparent' }, content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 24 }, pressed: { opacity: 0.66 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }, headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: '#172033', fontSize: 20, lineHeight: 28, fontWeight: '700' },
  list: { gap: 0 }, row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(104,122,144,0.18)', backgroundColor: 'rgba(255,255,255,0.22)' }, icon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 26 }, copy: { flex: 1, minWidth: 0 }, title: { color: '#172033', fontSize: 14, lineHeight: 20, fontWeight: '600' }, detail: { marginTop: 3, color: '#596579', fontSize: 13, lineHeight: 19, fontWeight: '500' },
});



