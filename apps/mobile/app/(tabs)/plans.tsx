import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { PLAN_DOMAIN_CATALOG, catalogTemplateCount, type PlanDomainCatalog } from '../../src/plan-domain-catalog';
import { consumerPlanStatusLabel, planNextRunLabel } from '../../src/plan-presenter';

type IconName = ComponentProps<typeof Ionicons>['name'];
type PageMode = 'catalog' | 'scheduled';
interface PlanSummary { id: string; status: string; name: string | null; description: string | null; domain: string | null; nextExpectedRunAt: string | null; hasMissingConnection: boolean; currentVersion: { name: string; domain?: string } | null }

const DOMAIN_MAP: Readonly<Record<string, string>> = {
  life: 'life', daily_life: 'life', living: 'living', family: 'family', pet: 'family', health: 'health', finance: 'finance', billing: 'finance', work: 'work', operations: 'work', content: 'work', study: 'study', information: 'information', travel: 'travel', social: 'social', entertainment: 'entertainment', housing: 'asset', vehicle: 'asset', device: 'asset', digital_account: 'asset', identity_docs: 'identity', government: 'identity', legal_contract: 'identity',
};
const ICON_TONES = ['#3F7BF4', '#8357E8', '#15A968', '#F17A16', '#3379E8', '#704FE2'] as const;
const ICON_BACKGROUNDS = ['#E8EFFF', '#EEE8FF', '#E4F8EF', '#FFF0E2', '#E7F0FF', '#EEE9FF'] as const;

export default function PlansPage() {
  const token = useAuthStore((store) => store.token);
  const [mode, setMode] = useState<PageMode>('catalog');
  const [domainKey, setDomainKey] = useState(PLAN_DOMAIN_CATALOG[0].key);
  const domain = PLAN_DOMAIN_CATALOG.find((item) => item.key === domainKey) ?? PLAN_DOMAIN_CATALOG[0];
  const plans = useQuery({ queryKey: ['plans', token], queryFn: () => api<PlanSummary[]>('/plans', token), enabled: Boolean(token && mode === 'scheduled') });
  const domainPlans = useMemo(() => (plans.data ?? []).filter((plan) => normalizePlanDomain(plan) === domain.key), [domain.key, plans.data]);

  const openCreate = (template?: string) => router.push(template ? ({ pathname: '/create', params: { intent: `创建“${template}”计划` } } as never) : '/create' as never);
  return <SafeAreaView edges={['top']} style={styles.safeArea}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={mode === 'scheduled' && token ? <RefreshControl tintColor="#2F6FDB" refreshing={plans.isFetching} onRefresh={() => plans.refetch()} /> : undefined}>
      <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="打开菜单" onPress={() => router.push('/profile' as never)} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><MenuGlyph /></Pressable><View style={styles.modeBar}><ModeButton icon="list" label="计划" selected={mode === 'catalog'} onPress={() => setMode('catalog')} /><ModeButton icon="time-outline" label="我的计划" selected={mode === 'scheduled'} onPress={() => setMode('scheduled')} /></View><Pressable accessibilityRole="button" accessibilityLabel="新建计划" onPress={() => openCreate()} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><Ionicons name="add" size={32} color="#18202C" /></Pressable></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.domainTabs}>{PLAN_DOMAIN_CATALOG.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: item.key === domain.key }} onPress={() => setDomainKey(item.key)} style={[styles.domainTab, item.key === domain.key && styles.domainTabSelected]}><Text style={[styles.domainText, item.key === domain.key && styles.domainTextSelected]}>{item.label}</Text></Pressable>)}</ScrollView>
      <View style={styles.domainIntro}><Text style={styles.domainTitle}>{domain.label} · {domain.english}</Text><Text style={styles.domainDescription}>{domain.description} · {catalogTemplateCount(domain)} 项</Text></View>

      {mode === 'catalog' ? <CatalogList domain={domain} onCreate={openCreate} /> : <ScheduledPlans token={token} plans={domainPlans} loading={plans.isLoading} error={plans.isError} onRetry={() => plans.refetch()} onCreate={openCreate} />}
    </ScrollView>
  </SafeAreaView>;
}

function ModeButton({ icon, label, selected, onPress }: { icon: IconName; label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.modeButton, selected && styles.modeButtonSelected]}><Ionicons name={icon} size={21} color={selected ? '#171D25' : '#7A8795'} /><Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>{label}</Text></Pressable>;
}

function MenuGlyph() { return <View style={styles.menuGlyph}><View style={styles.menuLong} /><View style={styles.menuShort} /></View>; }

function CatalogList({ domain, onCreate }: { domain: PlanDomainCatalog; onCreate: (name: string) => void }) {
  let itemIndex = 0;
  return <View>{domain.groups.map((group, groupIndex) => <View key={group.title ?? `group-${groupIndex}`}>{group.title ? <Text style={styles.groupTitle}>{group.title}</Text> : null}<View style={styles.list}>{group.templates.map((name) => { const index = itemIndex++; return <TemplateRow key={name} name={name} domain={domain} index={index} onCreate={() => onCreate(name)} />; })}</View></View>)}</View>;
}

function TemplateRow({ name, domain, index, onCreate }: { name: string; domain: PlanDomainCatalog; index: number; onCreate: () => void }) {
  const tone = ICON_TONES[index % ICON_TONES.length];
  return <Pressable accessibilityRole="button" accessibilityLabel={`创建${name}`} onPress={onCreate} style={({ pressed }) => [styles.templateRow, pressed && styles.pressed]}><View style={[styles.templateIcon, { backgroundColor: ICON_BACKGROUNDS[index % ICON_BACKGROUNDS.length] }]}><Ionicons name={templateIcon(name)} size={25} color={tone} /></View><View style={styles.templateCopy}><Text style={styles.templateName}>{name}</Text><Text numberOfLines={2} style={styles.templateDescription}>{templateDescription(name, domain.description)}</Text></View><View style={styles.rowAdd}><Ionicons name="add" size={26} color="#27313D" /></View></Pressable>;
}

function ScheduledPlans({ token, plans, loading, error, onRetry, onCreate }: { token?: string; plans: PlanSummary[]; loading: boolean; error: boolean; onRetry: () => void; onCreate: (name?: string) => void }) {
  if (!token) return <State icon="lock-closed-outline" title="登录后查看我的计划" detail="这里显示账号下真实创建并保存的计划。" action="去登录" onPress={() => router.push('/auth/login' as never)} />;
  if (loading) return <View style={styles.loading}><ActivityIndicator color="#2F6FDB" /><Text style={styles.stateDetail}>正在读取计划…</Text></View>;
  if (error) return <State icon="cloud-offline-outline" title="暂时无法读取计划" detail="服务器数据没有被本地示例替代。" action="重试" onPress={onRetry} />;
  if (plans.length === 0) return <State icon="calendar-outline" title="这个领域还没有我的计划" detail="选择上方“计划模板”中的模板开始创建。" action="创建计划" onPress={() => onCreate()} />;
  return <View style={styles.list}>{plans.map((plan, index) => <Pressable key={plan.id} onPress={() => router.push(`/plans/${plan.id}` as never)} style={({ pressed }) => [styles.templateRow, pressed && styles.pressed]}><View style={[styles.templateIcon, { backgroundColor: ICON_BACKGROUNDS[index % ICON_BACKGROUNDS.length] }]}><Ionicons name="time-outline" size={25} color={ICON_TONES[index % ICON_TONES.length]} /></View><View style={styles.templateCopy}><View style={styles.planTitleLine}><Text numberOfLines={1} style={styles.templateName}>{planName(plan)}</Text><Text style={styles.status}>{consumerPlanStatusLabel({ status: plan.status, hasMissingConnection: plan.hasMissingConnection })}</Text></View><Text numberOfLines={1} style={styles.templateDescription}>{plan.description ?? planNextRunLabel(plan.status, plan.nextExpectedRunAt)}</Text></View><Ionicons name="chevron-forward" size={20} color="#657382" /></Pressable>)}</View>;
}

function State({ icon, title, detail, action, onPress }: { icon: IconName; title: string; detail: string; action: string; onPress: () => void }) {
  return <View style={styles.state}><View style={styles.templateIcon}><Ionicons name={icon} size={25} color="#397BE8" /></View><View style={styles.templateCopy}><Text style={styles.templateName}>{title}</Text><Text style={styles.stateDetail}>{detail}</Text></View><Pressable onPress={onPress} style={styles.stateAction}><Text style={styles.stateActionText}>{action}</Text></Pressable></View>;
}

function normalizePlanDomain(plan: PlanSummary) { return DOMAIN_MAP[plan.domain ?? plan.currentVersion?.domain ?? ''] ?? 'life'; }
function planName(plan: PlanSummary) { return plan.name ?? plan.currentVersion?.name ?? '未命名计划'; }
function templateIcon(name: string): IconName {
  if (/提醒|到期|监控|守护/.test(name)) return 'notifications';
  if (/日历|日程|日期|赛程/.test(name)) return 'calendar';
  if (/账|财务|消费|预算|持仓|投资|基金|发票/.test(name)) return 'wallet';
  if (/健康|体检|用药|复诊|就医|睡眠|运动|减脂/.test(name)) return 'heart';
  if (/家庭|家人|孩子|亲子|伴侣|父母|宠物/.test(name)) return 'home';
  if (/旅行|行程|出行|航班|火车|转机|签证|行李/.test(name)) return 'airplane';
  if (/学习|课程|阅读|论文|考试|单词|知识|概念/.test(name)) return 'school';
  if (/消息|联系人|联系|沟通|群聊|聚会/.test(name)) return 'people';
  if (/文件|资料|材料|合同|证件|护照|身份/.test(name)) return 'document-text';
  if (/电影|剧集|播客|演出|游戏|比赛|体育|F1/.test(name)) return 'film';
  if (/整理|清单/.test(name)) return 'checkbox';
  return 'sparkles';
}
function templateDescription(name: string, fallback: string) {
  if (/提醒|守护/.test(name)) return `按你确认的时间和条件跟进${name.replace(/提醒|守护/g, '') || '重要事项'}，有变化时及时提醒。`;
  if (/监控|跟进|追踪/.test(name)) return `持续跟进${name.replace(/监控|跟进|追踪/g, '') || '进展'}，把重要变化集中呈现。`;
  if (/整理|汇总|小结|总结|摘要/.test(name)) return `收集并整理相关信息，生成清楚、可检查的${name}。`;
  if (/计划|安排|方案|路线|清单|准备/.test(name)) return `围绕你的目标和时间，逐步完成${name}。`;
  if (/报告|简报|分析|速览/.test(name)) return `汇集可靠来源，为你生成结构清晰的${name}。`;
  if (/推荐|精选|去哪儿|新鲜去处/.test(name)) return `结合你的偏好和条件，整理可比较的${name}。`;
  return `${fallback}，按你的条件创建“${name}”。`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'transparent' }, content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28 }, pressed: { opacity: 0.66 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 11, paddingHorizontal: 2 }, roundButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.94)' }, menuGlyph: { width: 25, gap: 7 }, menuLong: { width: 25, height: 3, borderRadius: 2, backgroundColor: '#18202C' }, menuShort: { width: 17, height: 3, borderRadius: 2, backgroundColor: '#18202C' },
  modeBar: { flex: 1, maxWidth: 250, flexDirection: 'row', padding: 4, borderRadius: 26, backgroundColor: 'rgba(166,196,228,0.34)' }, modeButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 22 }, modeButtonSelected: { backgroundColor: 'rgba(255,255,255,0.95)' }, modeLabel: { color: '#687588', fontSize: 15 }, modeLabelSelected: { color: '#161D28', fontWeight: '700' },
  domainTabs: { gap: 8, paddingVertical: 16, paddingRight: 26 }, domainTab: { minWidth: 58, minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 19, backgroundColor: 'rgba(170,198,226,0.24)' }, domainTabSelected: { backgroundColor: 'rgba(255,255,255,0.95)' }, domainText: { color: '#536678', fontSize: 15 }, domainTextSelected: { color: '#171D25', fontWeight: '700' }, domainIntro: { marginBottom: 10, paddingHorizontal: 3 }, domainTitle: { color: '#27333F', fontSize: 16, fontWeight: '700' }, domainDescription: { marginTop: 3, color: '#667585', fontSize: 13, lineHeight: 19 }, groupTitle: { marginTop: 11, marginBottom: 7, paddingLeft: 4, color: '#344251', fontSize: 15, fontWeight: '700' }, list: { gap: 8 },
  templateRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.98)', backgroundColor: 'rgba(255,255,255,0.84)' }, templateIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#E8EFFF' }, templateCopy: { flex: 1, minWidth: 0 }, templateName: { color: '#111820', fontSize: 17, lineHeight: 23, fontWeight: '700' }, templateDescription: { marginTop: 3, color: '#5C6978', fontSize: 14, lineHeight: 20 }, rowAdd: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.94)' },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10 }, state: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.72)' }, stateDetail: { marginTop: 3, color: '#5C6978', fontSize: 14, lineHeight: 20 }, stateAction: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.9)' }, stateActionText: { color: '#2F6FDB', fontSize: 14, fontWeight: '800' }, planTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 }, status: { color: '#167A4B', fontSize: 12, fontWeight: '700' },
});
