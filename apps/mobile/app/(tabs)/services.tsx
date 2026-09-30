import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, Surface, workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import { EXTRA_SERVICE_FILTER_OPTIONS, SERVICE_FILTER_OPTIONS, filterServiceProjections, isServiceTabDoubleTap, matchesServiceCategory, type ServiceFilterOption } from '../../src/service-filters';
import { filterServicePlans, type PresentedServicePlan, type ServiceKind, type ServicePlanProjection, type ServiceSection } from '../../src/service-presenter';

type IconName = ComponentProps<typeof Ionicons>['name'];

const SECTIONS: readonly { key: ServiceSection; label: string }[] = [
  { key: 'recommended', label: '推荐' },
  { key: 'following', label: '关注' },
  { key: 'nearby', label: '附近' },
  { key: 'active', label: '服务中' },
  { key: 'publish', label: '已发布' },
];

const SERVICE_SETTINGS_ITEMS: readonly { icon: IconName; label: string; detail: string; path: string }[] = [
  { icon: 'add-circle-outline', label: '发布服务', detail: '分享你的技能，开始接单', path: '/feature-placeholder?feature=service-publishing' },
  { icon: 'briefcase-outline', label: '加入服务', detail: '从发布到接单的完整流程', path: '/feature-placeholder?feature=join-service' },
  { icon: 'calendar-outline', label: '我的服务', detail: '管理我发布的服务', path: '/feature-placeholder?feature=my-services' },
  { icon: 'receipt-outline', label: '我的订单', detail: '服务订单与收入记录', path: '/feature-placeholder?feature=service-orders' },
  { icon: 'shield-checkmark-outline', label: '服务认证', detail: '提升可信度，获得更多曝光', path: '/feature-placeholder?feature=service-verification' },
  { icon: 'copy-outline', label: '服务模板', detail: '快速发布常用服务', path: '/feature-placeholder?feature=service-templates' },
  { icon: 'help-circle-outline', label: '帮助与反馈', detail: '遇到问题？我们来帮你', path: '/feature-placeholder?feature=help' },
  { icon: 'settings-outline', label: '服务设置', detail: '服务通知、接单与展示设置', path: '/feature-placeholder?feature=service-settings' },
];

interface EditorialServiceCard {
  key: string;
  kind: Exclude<ServiceKind, 'all'> | 'nearby';
  title: string;
  subtitle: string;
  tags: readonly string[];
  meta: string;
  action: string;
  path: string;
  compact?: boolean;
}

const EDITORIAL_CARDS: readonly EditorialServiceCard[] = [
  { key: 'annual-supply', kind: 'plan', title: '家庭一年补给方案', subtitle: '省心省力，让家庭补给不断档', tags: ['日用纸品', '洗护清洁', '厨房耗材'], meta: '正式场景 · family.family_supply', action: '查看方案', path: '/domains/family/family_supply' },
  { key: 'daily-cleaning', kind: 'service', title: '日常保洁', subtitle: '按房屋保养计划安排清洁', tags: ['全屋清洁', '定期提醒'], meta: '服务商与价格待接入', action: '查看详情', path: '/services/daily-cleaning' },
  { key: 'elder-care', kind: 'plan', title: '老人照护方案', subtitle: '让父母的重要事项有人跟进', tags: ['成员事项', '健康关怀'], meta: '正式场景 · family.member_affairs', action: '查看方案', path: '/domains/family/member_affairs' },
  { key: 'appliance-cleaning', kind: 'service', title: '家电清洗', subtitle: '空调、洗衣机与冰箱维护', tags: ['保养提醒', '结果确认'], meta: '服务商与价格待接入', action: '查看详情', path: '/services/appliance-cleaning' },
  { key: 'paper-supply', kind: 'supply', title: '纸品补给', subtitle: '根据真实库存生成补给建议', tags: ['库存事实', '采购清单'], meta: '创建计划后生成清单', action: '创建', path: '/create?scenarioKey=family.family_supply', compact: true },
  { key: 'care-supply', kind: 'supply', title: '洗护补给', subtitle: '温和清洁，全家适用', tags: ['库存事实', '用户确认'], meta: '创建计划后生成清单', action: '创建', path: '/create?scenarioKey=family.family_supply', compact: true },
  { key: 'move-in', kind: 'plan', title: '新房入住方案', subtitle: '从清洁到补给，分步骤准备', tags: ['房屋保养', '家庭补给'], meta: '组合正式场景创建', action: '查看方案', path: '/domains/housing/home_care' },
  { key: 'organization', kind: 'service', title: '收纳整理', subtitle: '空间规划，让家更整洁', tags: ['家庭任务', '结果确认'], meta: '服务商与价格待接入', action: '查看详情', path: '/services/organization' },
  { key: 'nearby', kind: 'nearby', title: '附近精选服务', subtitle: '接入位置与服务商后再展示距离', tags: ['位置需授权'], meta: '当前未读取位置', action: '接入来源', path: '/connections', compact: true },
  { key: 'kitchen-supply', kind: 'supply', title: '厨房补给', subtitle: '按消耗情况准备采购清单', tags: ['消费记录', '用户确认'], meta: '创建计划后生成清单', action: '创建', path: '/create?scenarioKey=family.family_supply', compact: true },
];

export default function ServicesSpace() {
  const token = useAuthStore((store) => store.token);
  const params = useLocalSearchParams<{ section?: string }>();
  const initialSection: ServiceSection = ['recommended', 'following', 'nearby', 'active', 'publish'].includes(params.section ?? '') ? params.section as ServiceSection : 'recommended';
  const [section, setSection] = useState<ServiceSection>(initialSection);
  const [query, setQuery] = useState('');
  const [openFilter, setOpenFilter] = useState<ServiceSection | null>(null);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<Record<ServiceSection, string>>({ recommended: 'all', following: 'all', nearby: 'all', active: 'all', publish: 'all' });
  const lastSectionTap = useRef<{ section: ServiceSection; at: number } | null>(null);
  const plans = useQuery({
    queryKey: ['service-plans', token],
    queryFn: () => api<ServicePlanProjection[]>('/plans', token),
    enabled: Boolean(token),
    staleTime: 15_000,
  });
  const selectedFilter = selectedFilters[section];
  const filteredPlans = useMemo(() => filterServiceProjections(plans.data ?? [], section, selectedFilter), [plans.data, section, selectedFilter]);
  const cards = useMemo(() => filterServicePlans(filteredPlans, section === 'active' && selectedFilter !== 'all' ? 'recommended' : section, query, 'all'), [filteredPlans, section, selectedFilter, query]);
  const editorialCards = useMemo(() => {
    if (section !== 'recommended') return [];
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return EDITORIAL_CARDS.filter((item) => matchesServiceCategory(`${item.title} ${item.subtitle} ${item.tags.join(' ')} ${item.key}`, selectedFilter))
      .filter((item) => !normalized || `${item.title} ${item.subtitle} ${item.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(normalized));
  }, [section, query, selectedFilter]);

  function selectSection(nextSection: ServiceSection) {
    const now = Date.now();
    const previous = lastSectionTap.current;
    setSection(nextSection);
    if (isServiceTabDoubleTap(previous, nextSection, now)) {
      setOpenFilter((current) => current === nextSection ? null : nextSection);
      setShowMoreFilters(false);
    } else if (openFilter) setOpenFilter(null);
    lastSectionTap.current = { section: nextSection, at: now };
  }

  function selectSectionFilter(option: ServiceFilterOption) {
    if (option.key === 'more') { setShowMoreFilters((current) => !current); return; }
    if (!openFilter) return;
    setSelectedFilters((current) => ({ ...current, [openFilter]: option.key }));
    setOpenFilter(null);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={plans.isFetching} onRefresh={() => plans.refetch()} /> : undefined}
      >
        <View style={styles.headingRow}><Text style={styles.heading}>服务</Text><Pressable accessibilityRole="button" accessibilityLabel="服务设置" onPress={() => setSettingsOpen(true)} style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}><Ionicons name="menu-outline" size={24} color={colors.text} /></Pressable></View>

        <View style={styles.searchBox}>
          <TextInput value={query} onChangeText={setQuery} placeholder="搜索服务、方案或发布者" placeholderTextColor={colors.textMuted} style={styles.searchInput} />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setQuery('')} style={styles.clearButton}><Ionicons name="close-circle" size={19} color={colors.textMuted} /></Pressable> : null}
        </View>

        <View accessibilityRole="tablist" style={styles.sectionTabs}>{SECTIONS.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: section === item.key }} accessibilityHint="双击展开分类筛选" onPress={() => selectSection(item.key)} onLongPress={() => { setSection(item.key); setOpenFilter(item.key); setShowMoreFilters(false); }} style={[styles.sectionTab, section === item.key && styles.sectionTabSelected]}><Text style={[styles.sectionTabText, section === item.key && styles.sectionTabTextSelected]}>{item.label}</Text>{selectedFilters[item.key] !== 'all' ? <View style={styles.filterDot} /> : null}</Pressable>)}</View>
        {openFilter ? <ServiceFilterMenu title={SECTIONS.find((item) => item.key === openFilter)?.label ?? '服务'} options={showMoreFilters ? [...SERVICE_FILTER_OPTIONS[openFilter], ...EXTRA_SERVICE_FILTER_OPTIONS[openFilter]] : SERVICE_FILTER_OPTIONS[openFilter]} selected={selectedFilters[openFilter]} expanded={showMoreFilters} onClose={() => setOpenFilter(null)} onSelect={selectSectionFilter} /> : null}

        {!token ? <Surface style={styles.stateSurface}><EmptyState icon="briefcase-outline" title="登录后查看服务" description="这里只展示属于你的真实计划、执行结果与可用服务状态。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface> : null}
        {token && section === 'publish' && selectedFilter === 'all' ? <PublishPanel /> : null}
        {token && section === 'publish' && selectedFilter !== 'all' ? <Surface style={styles.stateSurface}><EmptyState icon="briefcase-outline" title="暂无此类已发布服务" description="发布管理尚未接入，当前无法读取该分类的真实服务。" /></Surface> : null}
        {token && section !== 'publish' && plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取服务端计划…</Text></View> : null}
        {token && section !== 'publish' && plans.isError ? <Surface style={styles.stateSurface}><EmptyState icon="cloud-offline-outline" title="暂时无法读取服务" description="不会用本地示例替代服务端结果。" action={{ label: '重试', onPress: () => plans.refetch() }} /></Surface> : null}
        {token && section !== 'publish' && !plans.isLoading && !plans.isError && cards.length > 0 ? <><Text style={styles.groupTitle}>你的服务计划</Text><View style={styles.grid}>{cards.map((card) => <ServiceCard key={card.id} card={card} />)}</View></> : null}
        {token && section !== 'publish' && !plans.isLoading && !plans.isError && editorialCards.length > 0 ? <><Text style={[styles.groupTitle, cards.length > 0 && styles.groupTitleSpaced]}>服务与方案</Text><View style={styles.grid}>{editorialCards.map((card) => <EditorialCard key={card.key} card={card} />)}</View></> : null}
        {token && section !== 'publish' && !plans.isLoading && !plans.isError && cards.length === 0 && editorialCards.length === 0 ? <SectionEmpty section={section} searching={Boolean(query.trim())} /> : null}

        {token ? <View style={styles.boundary}><Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} /><Text style={styles.boundaryText}>方案、状态和结果来自服务端真实投影。价格、商家、距离、下单和支付在可信接口接入前不会展示或推断。</Text></View> : null}
      </ScrollView>
      <ServiceSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </SafeAreaView>
  );
}

function ServiceFilterMenu({ title, options, selected, expanded, onClose, onSelect }: { title: string; options: readonly ServiceFilterOption[]; selected: string; expanded: boolean; onClose: () => void; onSelect: (option: ServiceFilterOption) => void }) {
  return <View style={styles.filterMenu}><View style={styles.filterMenuHeader}><Text style={styles.filterMenuTitle}>{title} · 选择分类</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭分类筛选" onPress={onClose} style={styles.filterClose}><Ionicons name="close" size={20} color={colors.text} /></Pressable></View><View style={styles.filterGrid}>{options.map((option) => { const active = selected === option.key; return <Pressable key={option.key} accessibilityRole="button" accessibilityLabel={option.key === 'more' && expanded ? '收起更多分类' : option.label} accessibilityState={{ selected: active }} onPress={() => onSelect(option)} style={[styles.filterOption, active && styles.filterOptionSelected]}><Ionicons name={option.icon as IconName} size={18} color={active ? colors.text : colors.textSecondary} /><Text numberOfLines={1} style={[styles.filterOptionText, active && styles.filterOptionTextSelected]}>{option.key === 'more' && expanded ? '收起' : option.label}</Text></Pressable>; })}</View></View>;
}

function ServiceSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  function navigate(path: string) { onClose(); router.push(path as never); }
  return <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}><Pressable style={styles.drawerBackdrop} onPress={onClose}><Pressable style={styles.drawer} onPress={(event) => event.stopPropagation()}><SafeAreaView edges={['top', 'bottom']} style={styles.drawerSafe}><View style={styles.drawerHeader}><Text style={styles.drawerTitle}>服务设置</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭服务设置" onPress={onClose} style={styles.drawerClose}><Ionicons name="close" size={22} color={colors.text} /></Pressable></View><ScrollView contentContainerStyle={styles.drawerList}>{SERVICE_SETTINGS_ITEMS.map((item) => <Pressable key={item.label} accessibilityRole="button" onPress={() => navigate(item.path)} style={({ pressed }) => [styles.drawerItem, pressed && styles.pressed]}><View style={styles.drawerItemIcon}><Ionicons name={item.icon} size={21} color={colors.text} /></View><View style={styles.drawerItemCopy}><Text style={styles.drawerItemLabel}>{item.label}</Text><Text style={styles.drawerItemDetail}>{item.detail}</Text></View><Ionicons name="chevron-forward" size={16} color={colors.textMuted} /></Pressable>)}</ScrollView></SafeAreaView></Pressable></Pressable></Modal>;
}

function PublishPanel() {
  const items: readonly { icon: IconName; title: string; detail: string }[] = [
    { icon: 'construct-outline', title: '发布服务', detail: '提供可被他人预约的服务' },
    { icon: 'megaphone-outline', title: '发布需求', detail: '说明需要协助完成的事情' },
    { icon: 'cube-outline', title: '发布产品', detail: '发布有真实履约能力的产品' },
    { icon: 'layers-outline', title: '发布方案', detail: '分享可加入计划的方案' },
  ];
  return <View><Text style={styles.groupTitle}>用户发布</Text><View style={styles.publishGrid}>{items.map((item) => <Pressable key={item.title} onPress={() => router.push('/feature-placeholder?feature=service-publishing' as never)} style={({ pressed }) => [styles.publishItem, pressed && styles.pressed]}><View style={styles.publishIcon}><Ionicons name={item.icon} size={24} color={colors.primary} /></View><View style={styles.publishCopy}><Text style={styles.publishTitle}>{item.title}</Text><Text style={styles.publishDetail}>{item.detail}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>)}</View><View style={styles.publishNote}><Ionicons name="information-circle-outline" size={17} color={colors.primary} /><Text style={styles.boundaryText}>发布管理属于服务，不会转入待办；接口接入前仅保留明确的未建设入口。</Text></View></View>;
}

function ServiceCard({ card }: { card: PresentedServicePlan }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${card.kindLabel}，${card.title}，${card.statusLabel}`} onPress={() => router.push(`/plans/${card.id}` as never)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.cardBody}><Text numberOfLines={1} style={styles.cardTitle}>{card.title}</Text><Text numberOfLines={1} style={styles.cardSummary}>{card.summary}</Text></View>
      <Text numberOfLines={1} style={styles.cardStatus}>{card.statusLabel}</Text>
      <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
    </Pressable>
  );
}

function EditorialCard({ card }: { card: EditorialServiceCard }) {
  const kindLabel = card.kind === 'supply' ? '补给' : card.kind === 'service' ? '服务' : card.kind === 'nearby' ? '附近' : '方案';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${kindLabel}，${card.title}，${card.meta}`} onPress={() => router.push(card.path as never)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
    <View style={styles.cardBody}><Text numberOfLines={1} style={styles.cardTitle}>{card.title}</Text><Text numberOfLines={1} style={styles.cardSummary}>{card.subtitle}</Text><Text numberOfLines={1} style={styles.cardMeta}>{card.meta}</Text></View>
    <Text numberOfLines={1} style={styles.cardActionText}>{card.action}</Text>
    <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
  </Pressable>;
}

function SectionEmpty({ section, searching }: { section: ServiceSection; searching: boolean }) {
  if (searching) return <Surface style={styles.stateSurface}><EmptyState icon="search-outline" title="没有匹配结果" description="当前服务端计划中没有符合搜索词和筛选条件的项目。" /></Surface>;
  if (section === 'following') return <Surface style={styles.stateSurface}><EmptyState icon="heart-outline" title="还没有关注的服务" description="服务关注能力尚未接入服务端；不会在本地伪造关注状态。" /></Surface>;
  if (section === 'nearby') return <Surface style={styles.stateSurface}><EmptyState icon="location-outline" title="附近服务尚未接入" description="需要经过授权的位置来源和真实服务商接口后才能展示距离与可预约状态。" action={{ label: '查看连接', onPress: () => router.push('/connections' as never) }} /></Surface>;
  if (section === 'active') return <Surface style={styles.stateSurface}><EmptyState icon="time-outline" title="当前没有服务中的计划" description="服务端没有返回进行中、已暂停或等待处理的计划。" action={{ label: '查看全部计划', onPress: () => router.push('/plans' as never) }} /></Surface>;
  if (section === 'publish') return null;
  return <Surface style={styles.stateSurface}><EmptyState icon="sparkles-outline" title="还没有可展示的服务方案" description="先从真实场景创建计划，服务页会同步展示服务端状态。" action={{ label: '选择场景', onPress: () => router.push('/' as never) }} /></Surface>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  headingRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { ...typography.pageTitle, color: colors.text },
  settingsButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  headingActions: { flexDirection: 'row', alignItems: 'center' },
  headingAction: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm },
  headingActionText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  headingDivider: { width: 1, height: 20, marginHorizontal: 3, backgroundColor: colors.border },
  headingIconAction: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  headingIconActionSelected: { backgroundColor: colors.accentSoft },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: 10 },
  clearButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sectionTabs: { minHeight: 52, flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.md },
  sectionTab: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  sectionTabSelected: { borderBottomColor: colors.text },
  sectionTabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  sectionTabTextSelected: { color: colors.text, fontWeight: '800' },
  filterDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.text },
  filterMenu: { marginTop: -spacing.xs, marginBottom: spacing.lg, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterMenuHeader: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  filterMenuTitle: { ...typography.bodyStrong, color: colors.text },
  filterClose: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterOption: { width: '23%', minHeight: 62, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 3, borderRadius: radius.md, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: 'transparent' },
  filterOptionSelected: { borderColor: colors.text, backgroundColor: colors.surface },
  filterOptionText: { fontSize: 10, lineHeight: 14, color: colors.textSecondary, textAlign: 'center' },
  filterOptionTextSelected: { color: colors.text, fontWeight: '700' },
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  muted: { ...typography.body, color: colors.textSecondary },
  stateSurface: { marginTop: spacing.sm },
  groupTitle: { ...typography.section, color: colors.text, fontSize: 17, lineHeight: 23, marginBottom: spacing.sm },
  groupTitleSpaced: { marginTop: spacing.xl },
  grid: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  card: { width: '100%', minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cardPressed: { opacity: 0.62 },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { ...typography.bodyStrong, color: colors.text },
  cardSummary: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  cardMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  cardStatus: { ...typography.caption, color: colors.textSecondary },
  cardActionText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  publishGrid: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  publishItem: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  publishIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.accentSoft },
  publishCopy: { flex: 1 }, publishTitle: { ...typography.bodyStrong, color: colors.text }, publishDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  publishNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  boundary: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  boundaryText: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, flex: 1 },
  drawerBackdrop: { flex: 1, alignItems: 'flex-end', backgroundColor: 'rgba(15,24,34,0.46)' },
  drawer: { width: '82%', maxWidth: 380, height: '100%', backgroundColor: 'rgba(250,252,255,0.97)' },
  drawerSafe: { flex: 1 },
  drawerHeader: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  drawerTitle: { ...typography.title, color: colors.text },
  drawerClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.accentSoft },
  drawerList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  drawerItem: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  drawerItemIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.accentSoft },
  drawerItemCopy: { flex: 1, minWidth: 0 },
  drawerItemLabel: { ...typography.bodyStrong, color: colors.text },
  drawerItemDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  pressed: { opacity: 0.72 },
});
