import { SegmentedControl, ChipTabs, LoadingState } from '../../src/consumer-ui';
import { ConsumerPresentationMapper as presentation } from '../../src/consumer-presentation';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, resolveApiUrl } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { useExternalServices } from '../../src/external-services';

type IconName = ComponentProps<typeof Ionicons>['name'];
type ServiceMode = 'internal' | 'external';
interface ServiceOffering { id: string; domain: string; serviceType: string; deliveryMode: 'LOCAL' | 'REMOTE'; title: string; summary: string; tags: string[]; priceMinMinor: number | null; priceMaxMinor: number | null; currency: string | null; ratingBasisPoints: number | null; useCount: number; imageUrl: string | null; provider: { id: string; displayName: string; verified: boolean } }
interface ProviderProfile { id?: string; exists: boolean; canPublish: boolean }

export default function ServicesPage() {
  const token = useAuthStore((store) => store.token);
  const [mode, setMode] = useState<ServiceMode>('internal');
  const [queries, setQueries] = useState({ internal: '', external: '' }); const query = queries[mode]; const setQuery = (value: string) => setQueries(old => ({ ...old, [mode]: value }));
  const [categories, setCategories] = useState({ internal: '推荐', external: '推荐' }); const category = categories[mode]; const setCategory = (value: string) => setCategories(old => ({ ...old, [mode]: value }));
  const external = useExternalServices();
  const [externalError, setExternalError] = useState(''); const [externalLoading,setExternalLoading]=useState(true);
  useEffect(() => { setExternalLoading(true); external.hydrate().then(()=>setExternalError('')).catch(() => setExternalError('无法读取外部服务')).finally(()=>setExternalLoading(false)); }, [token]);
  const offerings = useQuery({ queryKey: ['service-offerings', token], queryFn: () => api<ServiceOffering[]>('/service-offerings', token), enabled: Boolean(token) });
  const profile = useQuery({ queryKey: ['service-provider-profile', token], queryFn: () => api<ProviderProfile>('/service-provider-profile', token), enabled: Boolean(token) });
  const visible = useMemo(() => (offerings.data ?? []).filter(item => category === '推荐' || ({ life: '生活', daily_life: '生活', family: '家庭', travel: '出行', health: '健康', work: '工作', other: '其他' } as Record<string, string>)[item.domain] === category).filter((item) => matches(`${presentation.text(item.title,'服务')} ${item.summary} ${item.tags.join(' ')} ${item.provider.displayName}`, query)), [mode, offerings.data, query, category]);
  const published = (offerings.data ?? []).filter(item => item.provider.id === profile.data?.id);
  const externalVisible = external.items.filter(item => category === '推荐' || item.category === category).filter(item => matches(item.name + ' ' + item.description, query));
  const refresh = () => { if (mode === 'external') { void external.hydrate().then(()=>setExternalError('')).catch(()=>setExternalError('无法读取外部服务，请重试')); } else void Promise.all([offerings.refetch(), profile.refetch()]); };

  return <SafeAreaView edges={['top']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={token ? <RefreshControl tintColor="#2F7AF4" refreshing={offerings.isFetching || profile.isFetching} onRefresh={refresh} /> : undefined}>
      <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="打开菜单" onPress={() => router.push('/profile' as never)} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><MenuGlyph /></Pressable><View style={{flex:1}}><SegmentedControl value={mode} options={[{value:'internal',label:'内部服务'},{value:'external',label:'外部服务'}]} onChange={setMode}/></View><Pressable accessibilityRole="button" accessibilityLabel={mode === 'internal' ? '发布服务' : '添加外部服务'} onPress={() => router.push((mode === 'internal' ? '/publish-service' : '/add-external-reference') as never)} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><Ionicons name="add" size={27} color="#111827" /></Pressable></View>

      <View style={styles.search}><Ionicons name="search-outline" size={27} color="#4E6080" /><TextInput value={query} onChangeText={setQuery} placeholder="搜索服务、商家或关键词" placeholderTextColor="#697992" style={styles.searchInput} />{query ? <Pressable accessibilityLabel="清空搜索" onPress={() => setQuery('')}><Ionicons name="close-circle" size={22} color="#7E8A9B" /></Pressable> : null}</View>

      <ChipTabs value={category} options={['推荐','生活','家庭','出行','健康','工作','其他'].map(label=>({value:label,label}))} onChange={setCategory}/>
      <Text style={[styles.stateDetail, { marginTop: 14 }]}>{mode === 'internal' ? '懒人装甲平台内提供和发布的服务' : '从第三方 App、网页分享的具体服务'}</Text>
      {mode === 'internal' ? <Pressable style={{ paddingVertical: 12 }} onPress={() => router.push('/service-requests' as never)}><Text style={{ color: '#287BFF' }}>我的服务请求 ›</Text></Pressable> : null}<Text style={[styles.rowTitle, { marginTop: 18 }]}>{mode === 'internal' ? '推荐服务' : '我的外部服务'}</Text>
      {mode === 'external' ? <View style={styles.list}>{external.items.filter(item => category === '推荐' || item.category === category).filter(item => matches(`${presentation.text(item.name,'外部服务')} ${item.description}`, query)).map(item => <View key={item.id} style={styles.row}><Pressable style={[styles.rowIcon, { backgroundColor: item.color }]} onPress={() => router.push(`/external-service-detail?id=${item.id}` as never)}><Ionicons name="link" size={26} color="#FFF" /></Pressable><Pressable style={styles.rowCopy} onPress={() => router.push(`/external-service-detail?id=${item.id}` as never)}><Text style={styles.rowTitle}>{presentation.text(item.name,'外部服务')}</Text><Text style={styles.rowDetail}>{presentation.text(item.description || item.url,'具体服务链接')}</Text></Pressable><Pressable accessibilityLabel={`移除${presentation.text(item.name,'外部服务')}`} onPress={() => external.remove(item.id).catch(() => setExternalError('移除失败，请重试'))}><Ionicons name="close-circle-outline" size={22} color="#7384A0" /></Pressable></View>)}{externalLoading ? <LoadingState/> : null}{!externalLoading && !externalError && externalVisible.length === 0 ? <State icon="link" title={external.items.length ? '没有匹配的外部服务' : '还没有外部服务'} detail="添加具体服务链接。" action="添加服务" onPress={() => router.push('/add-external-reference' as never)} /> : null}{externalError ? <State icon="cloud-offline-outline" title="暂时无法读取" detail={externalError} action="重试" onPress={refresh}/> : null}</View> : null}
      {mode === 'internal' && !token ? <State icon="lock-closed-outline" title="登录后查看服务" detail="服务目录与你的账号和计划关联。" action="去登录" onPress={() => router.push('/auth/login' as never)} /> : null}
      {mode === 'internal' && token && offerings.isLoading ? <View style={styles.loading}><ActivityIndicator color="#2F7AF4" /><Text style={styles.stateDetail}>正在读取真实服务目录…</Text></View> : null}
      {mode === 'internal' && token && offerings.isError ? <State icon="cloud-offline-outline" title="暂时无法读取服务" detail="当前没有取得服务端目录。" action="重试" onPress={refresh} /> : null}

      {mode === 'internal' && token && !offerings.isLoading && !offerings.isError && visible.length > 0 ? <View style={styles.list}>{visible.map((item) => <ServiceRow key={item.id} item={item} />)}</View> : null}
      {mode === 'internal' && token && !offerings.isLoading && !offerings.isError && visible.length === 0 ? <State icon={mode === 'internal' ? 'location-outline' : 'globe-outline'} title={query ? '没有匹配的服务' : mode === 'internal' ? '暂无已发布的内部服务' : '暂无远程服务'} detail="这里只展示服务端已发布的真实服务。" action="发布服务" onPress={() => router.push('/publish-service' as never)} /> : null}
      {mode === 'internal' && token && !offerings.isLoading && !offerings.isError ? <View style={{ marginTop: 22 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={styles.rowTitle}>我发布的服务</Text><Pressable onPress={() => router.push('/publish-service' as never)}><Text style={{ color: '#287BFF' }}>发布服务 ＋</Text></Pressable></View>{published.length ? <View style={styles.list}>{published.map(item => <ServiceRow key={item.id} item={item} />)}</View> : <Text style={[styles.stateDetail, { paddingVertical: 14 }]}>你还没有已发布的服务</Text>}</View> : null}
    </ScrollView>
  </SafeAreaView>;
}

function ModeButton({ icon, label, selected, onPress }: { icon: IconName; label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.modeButton, selected && styles.modeButtonSelected]}><Ionicons name={icon} size={19} color={selected ? '#121923' : '#63728A'} /><Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>{label}</Text></Pressable>;
}
function MenuGlyph() { return <View style={styles.menuGlyph}><View style={styles.menuLong} /><View style={styles.menuShort} /></View>; }

function ServiceRow({ item }: { item: ServiceOffering }) {
  const rating = item.ratingBasisPoints === null ? null : (item.ratingBasisPoints / 100).toFixed(1);
  return <Pressable accessibilityRole="button" onPress={() => router.push(`/service-detail?id=${item.id}` as never)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <View style={[styles.rowIcon, { backgroundColor: iconBackground(item.serviceType) }]}>{item.imageUrl ? <Image source={{uri:item.imageUrl.startsWith('/api/') ? resolveApiUrl()+item.imageUrl : item.imageUrl}} style={{width:54,height:54,borderRadius:16}}/> : <Ionicons name={serviceIcon(item.serviceType)} size={31} color={iconColor(item.serviceType)} />}</View>
    <View style={styles.rowCopy}><Text style={styles.rowTitle}>{presentation.text(item.title,'服务')}</Text><Text numberOfLines={1} style={styles.rowDetail}>{presentation.text(item.summary || item.provider.displayName)}</Text>{item.tags.length ? <Text numberOfLines={1} style={styles.rowMeta}>{item.deliveryMode === 'LOCAL' ? '上门服务　' : '远程服务　'}{item.tags.slice(0, 3).join('　')}</Text> : <Text style={styles.rowMeta}>{item.provider.displayName}{item.provider.verified ? '　已认证' : ''}</Text>}</View>
    <View style={styles.rowEnd}>{item.priceMinMinor !== null ? <Text style={styles.rating}>{item.currency === 'CNY' || !item.currency ? '¥' : item.currency}{(item.priceMinMinor/100).toFixed(2)}起</Text> : null}{rating ? <Text style={styles.rating}>{rating}分</Text> : null}{item.useCount > 0 ? <Text style={styles.useCount}>{item.useCount} 次使用</Text> : null}</View><Ionicons name="chevron-forward" size={24} color="#52617B" />
  </Pressable>;
}

function State({ icon, title, detail, action, onPress }: { icon: IconName; title: string; detail: string; action: string; onPress: () => void }) {
  return <View style={styles.state}><View style={styles.stateIcon}><Ionicons name={icon} size={28} color="#2F7AF4" /></View><View style={styles.stateCopy}><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateDetail}>{detail}</Text></View><Pressable onPress={onPress} style={styles.stateAction}><Text style={styles.stateActionText}>{action}</Text></Pressable></View>;
}

function matches(value: string, query: string) { const q = query.trim().toLocaleLowerCase('zh-CN'); return !q || value.toLocaleLowerCase('zh-CN').includes(q); }
function serviceIcon(kind: string): IconName { if (/device/i.test(kind)) return 'construct'; if (/purchase/i.test(kind)) return 'cart'; if (/booking/i.test(kind)) return 'calendar'; if (/errand/i.test(kind)) return 'walk'; if (/consult/i.test(kind)) return 'chatbubbles'; if (/information/i.test(kind)) return 'search'; return 'briefcase'; }
function iconColor(kind: string) { if (/purchase/i.test(kind)) return '#F2447C'; if (/errand/i.test(kind)) return '#10B981'; if (/device/i.test(kind)) return '#F59E0B'; if (/consult/i.test(kind)) return '#7C5CE5'; return '#2385ED'; }
function iconBackground(kind: string) { if (/purchase/i.test(kind)) return '#FFE9F1'; if (/errand/i.test(kind)) return '#E3FAF0'; if (/device/i.test(kind)) return '#FFF1DB'; if (/consult/i.test(kind)) return '#EFE9FF'; return '#E4F2FF'; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'transparent' }, content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24 }, pressed: { opacity: 0.66 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 }, roundButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(237,242,247,0.3)' }, menuGlyph: { width: 21, gap: 6 }, menuLong: { width: 21, height: 2.5, borderRadius: 2, backgroundColor: '#18202C' }, menuShort: { width: 14, height: 2.5, borderRadius: 2, backgroundColor: '#18202C' },
  modeBar: { flex: 1, maxWidth: 290, flexDirection: 'row', padding: 3, borderRadius: 22, backgroundColor: 'rgba(139,166,196,0.34)' }, modeButton: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 19 }, modeButtonSelected: { backgroundColor: 'rgba(255,255,255,0.74)' }, modeLabel: { color: '#45556B', fontSize: 14, fontWeight: '500' }, modeLabelSelected: { color: '#172033', fontWeight: '600' },
  search: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 10, paddingHorizontal: 13, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(104,122,144,0.12)', backgroundColor: 'rgba(255,255,255,0.32)' }, searchInput: { flex: 1, color: '#172033', fontSize: 14, paddingVertical: 8 },
  list: { marginTop: 8, gap: 0, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.28)' }, row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(100,120,150,0.24)' }, rowIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 16 }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { color: '#172033', fontSize: 14, lineHeight: 20, fontWeight: '700' }, rowDetail: { marginTop: 1, color: '#596579', fontSize: 12, lineHeight: 18 }, rowMeta: { marginTop: 2, color: '#69778A', fontSize: 11, lineHeight: 16 }, rowEnd: { minWidth: 38, alignItems: 'flex-end', gap: 3 }, rating: { color: '#465777', fontSize: 13, fontWeight: '600' }, useCount: { color: '#596579', fontSize: 11 },
  loading: { minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 9 }, state: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(104,122,144,0.12)', backgroundColor: 'rgba(255,255,255,0.32)' }, stateIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: '#E0EAF4' }, stateCopy: { flex: 1 }, stateTitle: { color: '#172033', fontSize: 15, lineHeight: 21, fontWeight: '700' }, stateDetail: { marginTop: 2, color: '#596579', fontSize: 13, lineHeight: 18 }, stateAction: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(229,237,245,0.72)' }, stateActionText: { color: '#2B75D6', fontSize: 12, fontWeight: '600' },
});
