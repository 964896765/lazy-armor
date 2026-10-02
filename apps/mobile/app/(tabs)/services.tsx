import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';

type IconName = ComponentProps<typeof Ionicons>['name'];
type ServiceMode = 'local' | 'remote';
interface ServiceOffering { id: string; domain: string; serviceType: string; title: string; summary: string; tags: string[]; priceMinMinor: number | null; priceMaxMinor: number | null; currency: string | null; ratingBasisPoints: number | null; useCount: number; imageUrl: string | null; provider: { id: string; displayName: string; verified: boolean } }
interface ProviderProfile { exists: boolean; canPublish: boolean }

export default function ServicesPage() {
  const token = useAuthStore((store) => store.token);
  const [mode, setMode] = useState<ServiceMode>('local');
  const [query, setQuery] = useState('');
  const offerings = useQuery({ queryKey: ['service-offerings', token], queryFn: () => api<ServiceOffering[]>('/service-offerings', token), enabled: Boolean(token) });
  const profile = useQuery({ queryKey: ['service-provider-profile', token], queryFn: () => api<ProviderProfile>('/service-provider-profile', token), enabled: Boolean(token) });
  const visible = useMemo(() => (offerings.data ?? []).filter((item) => serviceMode(item) === mode).filter((item) => matches(`${item.title} ${item.summary} ${item.tags.join(' ')} ${item.provider.displayName}`, query)), [mode, offerings.data, query]);
  const refresh = () => { void Promise.all([offerings.refetch(), profile.refetch()]); };

  return <SafeAreaView edges={['top']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={token ? <RefreshControl tintColor="#2F7AF4" refreshing={offerings.isFetching || profile.isFetching} onRefresh={refresh} /> : undefined}>
      <View style={styles.header}>
        <View><Text style={styles.pageTitle}>服务</Text><Text style={styles.pageSubtitle}>为计划连接可信的现实服务</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="我的服务" onPress={() => router.push(`/feature-placeholder?feature=${profile.data?.canPublish ? 'service-publishing' : 'my-services'}` as never)} style={({ pressed }) => [styles.myServices, pressed && styles.pressed]}><Ionicons name="options-outline" size={17} color="#1769E0" /><Text style={styles.myServicesText}>我的服务</Text></Pressable>
      </View>
      <View style={styles.modeBar}><ModeButton icon="storefront-outline" label="本地" selected={mode === 'local'} onPress={() => setMode('local')} /><ModeButton icon="globe-outline" label="远程" selected={mode === 'remote'} onPress={() => setMode('remote')} /></View>

      <View style={styles.search}><Ionicons name="search-outline" size={27} color="#4E6080" /><TextInput value={query} onChangeText={setQuery} placeholder="搜索服务、商家或关键词" placeholderTextColor="#697992" style={styles.searchInput} />{query ? <Pressable accessibilityLabel="清空搜索" onPress={() => setQuery('')}><Ionicons name="close-circle" size={22} color="#7E8A9B" /></Pressable> : null}</View>

      {!token ? <State icon="lock-closed-outline" title="登录后查看服务" detail="服务目录与你的账号和计划关联。" action="去登录" onPress={() => router.push('/auth/login' as never)} /> : null}
      {token && offerings.isLoading ? <View style={styles.loading}><ActivityIndicator color="#2F7AF4" /><Text style={styles.stateDetail}>正在读取真实服务目录…</Text></View> : null}
      {token && offerings.isError ? <State icon="cloud-offline-outline" title="暂时无法读取服务" detail="当前没有取得服务端目录。" action="重试" onPress={refresh} /> : null}
      {token && !offerings.isLoading && !offerings.isError && visible.length > 0 ? <View style={styles.list}>{visible.map((item) => <ServiceRow key={item.id} item={item} />)}</View> : null}
      {token && !offerings.isLoading && !offerings.isError && visible.length === 0 ? <State icon={mode === 'local' ? 'location-outline' : 'globe-outline'} title={query ? '没有匹配的服务' : mode === 'local' ? '附近暂无已发布服务' : '暂无远程服务'} detail="这里只展示服务端已发布的真实服务。" action="查看计划" onPress={() => router.push('/plans' as never)} /> : null}
    </ScrollView>
  </SafeAreaView>;
}

function ModeButton({ icon, label, selected, onPress }: { icon: IconName; label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.modeButton, selected && styles.modeButtonSelected]}><Ionicons name={icon} size={22} color={selected ? '#121923' : '#63728A'} /><Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>{label}</Text></Pressable>;
}

function ServiceRow({ item }: { item: ServiceOffering }) {
  const rating = item.ratingBasisPoints === null ? null : (item.ratingBasisPoints / 100).toFixed(1);
  return <Pressable accessibilityRole="button" onPress={() => router.push(`/feature-placeholder?feature=service-${item.id}` as never)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <View style={[styles.rowIcon, { backgroundColor: iconBackground(item.serviceType) }]}><Ionicons name={serviceIcon(item.serviceType)} size={31} color={iconColor(item.serviceType)} /></View>
    <View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.title}</Text><Text numberOfLines={1} style={styles.rowDetail}>{item.summary || item.provider.displayName}</Text>{item.tags.length ? <Text numberOfLines={1} style={styles.rowMeta}>{item.tags.slice(0, 3).join('　')}</Text> : <Text style={styles.rowMeta}>{item.provider.displayName}{item.provider.verified ? '　已认证' : ''}</Text>}</View>
    <View style={styles.rowEnd}>{rating ? <Text style={styles.rating}>{rating}分</Text> : null}{item.useCount > 0 ? <Text style={styles.useCount}>{item.useCount} 次使用</Text> : null}</View><Ionicons name="chevron-forward" size={24} color="#52617B" />
  </Pressable>;
}

function State({ icon, title, detail, action, onPress }: { icon: IconName; title: string; detail: string; action: string; onPress: () => void }) {
  return <View style={styles.state}><View style={styles.stateIcon}><Ionicons name={icon} size={28} color="#2F7AF4" /></View><View style={styles.stateCopy}><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateDetail}>{detail}</Text></View><Pressable onPress={onPress} style={styles.stateAction}><Text style={styles.stateActionText}>{action}</Text></Pressable></View>;
}

function serviceMode(item: ServiceOffering): ServiceMode { return /local|device|errand|booking/i.test(`${item.domain} ${item.serviceType}`) ? 'local' : 'remote'; }
function matches(value: string, query: string) { const q = query.trim().toLocaleLowerCase('zh-CN'); return !q || value.toLocaleLowerCase('zh-CN').includes(q); }
function serviceIcon(kind: string): IconName { if (/device/i.test(kind)) return 'construct'; if (/purchase/i.test(kind)) return 'cart'; if (/booking/i.test(kind)) return 'calendar'; if (/errand/i.test(kind)) return 'walk'; if (/consult/i.test(kind)) return 'chatbubbles'; if (/information/i.test(kind)) return 'search'; return 'briefcase'; }
function iconColor(kind: string) { if (/purchase/i.test(kind)) return '#F2447C'; if (/errand/i.test(kind)) return '#10B981'; if (/device/i.test(kind)) return '#F59E0B'; if (/consult/i.test(kind)) return '#7C5CE5'; return '#2385ED'; }
function iconBackground(kind: string) { if (/purchase/i.test(kind)) return '#FFE9F1'; if (/errand/i.test(kind)) return '#E3FAF0'; if (/device/i.test(kind)) return '#FFF1DB'; if (/consult/i.test(kind)) return '#EFE9FF'; return '#E4F2FF'; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'rgba(248,250,253,0.90)' }, content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24 }, pressed: { opacity: 0.66 },
  header: { minHeight: 62, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }, pageTitle: { color: '#111827', fontSize: 30, lineHeight: 37, fontWeight: '700' }, pageSubtitle: { marginTop: 2, color: '#6B7788', fontSize: 14, lineHeight: 20 }, myServices: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#D8E2F0', backgroundColor: '#FFFFFF' }, myServicesText: { color: '#1769E0', fontSize: 14, fontWeight: '600' },
  modeBar: { alignSelf: 'flex-start', flexDirection: 'row', gap: 22, marginTop: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#DCE3EC' }, modeButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 2, borderBottomWidth: 2, borderBottomColor: 'transparent' }, modeButtonSelected: { borderBottomColor: '#2F80ED' }, modeLabel: { color: '#687588', fontSize: 14 }, modeLabelSelected: { color: '#162033', fontWeight: '600' },
  search: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, paddingHorizontal: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#DCE4ED', backgroundColor: '#FFFFFF' }, searchInput: { flex: 1, color: '#152033', fontSize: 15, paddingVertical: 10 },
  list: { overflow: 'hidden', marginTop: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#DEE6EF', backgroundColor: '#FFFFFF' }, row: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E7ECF2' }, rowIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14 }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { color: '#162033', fontSize: 16, lineHeight: 22, fontWeight: '600' }, rowDetail: { marginTop: 2, color: '#697688', fontSize: 13, lineHeight: 19 }, rowMeta: { marginTop: 3, color: '#7A8798', fontSize: 12, lineHeight: 17 }, rowEnd: { minWidth: 42, alignItems: 'flex-end', gap: 4 }, rating: { color: '#465777', fontSize: 14, fontWeight: '600' }, useCount: { color: '#69788D', fontSize: 12 },
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 10 }, state: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14, padding: 13, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.76)' }, stateIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#E8F2FF' }, stateCopy: { flex: 1 }, stateTitle: { color: '#111925', fontSize: 16, lineHeight: 23, fontWeight: '800' }, stateDetail: { marginTop: 3, color: '#607086', fontSize: 13, lineHeight: 19 }, stateAction: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.94)' }, stateActionText: { color: '#2F7AF4', fontSize: 13, fontWeight: '800' },
});
