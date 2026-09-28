import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, type ImageSourcePropType, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { EmptyState, Surface, workspaceColors as colors, radius, spacing, typography } from '../../src/design';
import { filterServicePlans, type PresentedServicePlan, type ServiceKind, type ServicePlanProjection, type ServiceSection } from '../../src/service-presenter';

type IconName = ComponentProps<typeof Ionicons>['name'];

const SECTIONS: readonly { key: ServiceSection; label: string }[] = [
  { key: 'recommended', label: '推荐' },
  { key: 'following', label: '关注' },
  { key: 'nearby', label: '附近' },
  { key: 'active', label: '服务中' },
  { key: 'publish', label: '发布' },
];

const KINDS: readonly { key: ServiceKind; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'plan', label: '方案' },
  { key: 'service', label: '服务' },
  { key: 'supply', label: '补给' },
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
  image: ImageSourcePropType;
  compact?: boolean;
}

const EDITORIAL_CARDS: readonly EditorialServiceCard[] = [
  { key: 'annual-supply', kind: 'plan', title: '家庭一年补给方案', subtitle: '省心省力，让家庭补给不断档', tags: ['日用纸品', '洗护清洁', '厨房耗材'], meta: '正式场景 · family.family_supply', action: '查看方案', path: '/domains/family/family_supply', image: require('../../assets/services/household-supply.jpg') },
  { key: 'daily-cleaning', kind: 'service', title: '日常保洁', subtitle: '按房屋保养计划安排清洁', tags: ['全屋清洁', '定期提醒'], meta: '服务商与价格待接入', action: '查看能力', path: '/domains/housing/home_care', image: require('../../assets/services/home-cleaning.jpg') },
  { key: 'elder-care', kind: 'plan', title: '老人照护方案', subtitle: '让父母的重要事项有人跟进', tags: ['成员事项', '健康关怀'], meta: '正式场景 · family.member_affairs', action: '查看方案', path: '/domains/family/member_affairs', image: require('../../assets/services/elder-care.jpg') },
  { key: 'appliance-cleaning', kind: 'service', title: '家电清洗', subtitle: '空调、洗衣机与冰箱维护', tags: ['保养提醒', '结果确认'], meta: '服务商与价格待接入', action: '查看能力', path: '/domains/housing/maintenance', image: require('../../assets/services/appliance-cleaning.jpg') },
  { key: 'paper-supply', kind: 'supply', title: '纸品补给', subtitle: '根据真实库存生成补给建议', tags: ['库存事实', '采购清单'], meta: '创建计划后生成清单', action: '创建', path: '/create?scenarioKey=family.family_supply', image: require('../../assets/services/household-supply.jpg'), compact: true },
  { key: 'care-supply', kind: 'supply', title: '洗护补给', subtitle: '温和清洁，全家适用', tags: ['库存事实', '用户确认'], meta: '创建计划后生成清单', action: '创建', path: '/create?scenarioKey=family.family_supply', image: require('../../assets/services/appliance-cleaning.jpg'), compact: true },
  { key: 'move-in', kind: 'plan', title: '新房入住方案', subtitle: '从清洁到补给，分步骤准备', tags: ['房屋保养', '家庭补给'], meta: '组合正式场景创建', action: '查看方案', path: '/domains/housing/home_care', image: require('../../assets/services/move-in.jpg') },
  { key: 'organization', kind: 'service', title: '收纳整理', subtitle: '空间规划，让家更整洁', tags: ['家庭任务', '结果确认'], meta: '服务商与价格待接入', action: '查看能力', path: '/domains/family/household_tasks', image: require('../../assets/services/home-organization.jpg') },
  { key: 'nearby', kind: 'nearby', title: '附近精选服务', subtitle: '接入位置与服务商后再展示距离', tags: ['位置需授权'], meta: '当前未读取位置', action: '接入来源', path: '/connections', image: require('../../assets/services/home-cleaning.jpg'), compact: true },
  { key: 'kitchen-supply', kind: 'supply', title: '厨房补给', subtitle: '按消耗情况准备采购清单', tags: ['消费记录', '用户确认'], meta: '创建计划后生成清单', action: '创建', path: '/create?scenarioKey=family.family_supply', image: require('../../assets/services/household-supply.jpg'), compact: true },
];

export default function ServicesSpace() {
  const token = useAuthStore((store) => store.token);
  const params = useLocalSearchParams<{ section?: string }>();
  const initialSection: ServiceSection = ['recommended', 'following', 'nearby', 'active', 'publish'].includes(params.section ?? '') ? params.section as ServiceSection : 'recommended';
  const [section, setSection] = useState<ServiceSection>(initialSection);
  const [kind, setKind] = useState<ServiceKind>('all');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const plans = useQuery({
    queryKey: ['service-plans', token],
    queryFn: () => api<ServicePlanProjection[]>('/plans', token),
    enabled: Boolean(token),
    staleTime: 15_000,
  });
  const cards = useMemo(() => filterServicePlans(plans.data ?? [], section, query, kind), [plans.data, section, query, kind]);
  const editorialCards = useMemo(() => {
    if (section !== 'recommended') return [];
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return EDITORIAL_CARDS.filter((item) => kind === 'all' || item.kind === kind)
      .filter((item) => !normalized || `${item.title} ${item.subtitle} ${item.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(normalized));
  }, [section, query, kind]);

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={token ? <RefreshControl tintColor={colors.primary} refreshing={plans.isFetching} onRefresh={() => plans.refetch()} /> : undefined}
      >
        <View style={styles.headingRow}>
          <Text style={styles.heading}>服务</Text>
          <View style={styles.headingActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="搜索服务" onPress={() => setSearchOpen((value) => !value)} style={({ pressed }) => [styles.headingAction, pressed && styles.pressed]}><Ionicons name="search-outline" size={20} color={colors.text} /><Text style={styles.headingActionText}>搜索</Text></Pressable>
            <View style={styles.headingDivider} />
            <Pressable accessibilityRole="button" accessibilityLabel={filtersOpen ? '收起筛选' : '打开筛选'} accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen((value) => !value)} style={({ pressed }) => [styles.headingIconAction, filtersOpen && styles.headingIconActionSelected, pressed && styles.pressed]}><Ionicons name="options-outline" size={21} color={colors.text} /></Pressable>
          </View>
        </View>

        {searchOpen ? <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="搜索方案、服务或补给" placeholderTextColor={colors.textMuted} style={styles.searchInput} />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => setQuery('')} style={styles.clearButton}><Ionicons name="close-circle" size={19} color={colors.textMuted} /></Pressable> : null}
        </View> : null}

        {filtersOpen ? <View accessibilityRole="tablist" style={styles.kindFilters}>{KINDS.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: kind === item.key }} onPress={() => setKind(item.key)} style={[styles.kindChip, kind === item.key && styles.kindChipSelected]}><Text style={[styles.kindChipText, kind === item.key && styles.kindChipTextSelected]}>{item.label}</Text></Pressable>)}</View> : null}

        <View accessibilityRole="tablist" style={styles.sectionTabs}>{SECTIONS.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: section === item.key }} onPress={() => setSection(item.key)} style={[styles.sectionTab, section === item.key && styles.sectionTabSelected]}><Text style={[styles.sectionTabText, section === item.key && styles.sectionTabTextSelected]}>{item.label}</Text></Pressable>)}</View>

        {!token ? <Surface style={styles.stateSurface}><EmptyState icon="briefcase-outline" title="登录后查看服务" description="这里只展示属于你的真实计划、执行结果与可用服务状态。" action={{ label: '去登录', onPress: () => router.push('/auth/login' as never) }} /></Surface> : null}
        {token && section === 'publish' ? <PublishPanel /> : null}
        {token && section !== 'publish' && plans.isLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>正在读取服务端计划…</Text></View> : null}
        {token && section !== 'publish' && plans.isError ? <Surface style={styles.stateSurface}><EmptyState icon="cloud-offline-outline" title="暂时无法读取服务" description="不会用本地示例替代服务端结果。" action={{ label: '重试', onPress: () => plans.refetch() }} /></Surface> : null}
        {token && section !== 'publish' && !plans.isLoading && !plans.isError && cards.length > 0 ? <><Text style={styles.groupTitle}>你的服务计划</Text><View style={styles.grid}>{cards.map((card, index) => <ServiceCard key={card.id} card={card} image={EDITORIAL_CARDS[index % EDITORIAL_CARDS.length].image} />)}</View></> : null}
        {token && section !== 'publish' && !plans.isLoading && !plans.isError && editorialCards.length > 0 ? <><Text style={[styles.groupTitle, cards.length > 0 && styles.groupTitleSpaced]}>服务与方案</Text><View style={styles.grid}>{editorialCards.map((card) => <EditorialCard key={card.key} card={card} />)}</View></> : null}
        {token && section !== 'publish' && !plans.isLoading && !plans.isError && cards.length === 0 && editorialCards.length === 0 ? <SectionEmpty section={section} searching={Boolean(query.trim())} /> : null}

        {token ? <View style={styles.boundary}><Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} /><Text style={styles.boundaryText}>方案、状态和结果来自服务端真实投影。价格、商家、距离、下单和支付在可信接口接入前不会展示或推断。</Text></View> : null}
      </ScrollView>
    </SafeAreaView>
  );
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

function ServiceCard({ card, image }: { card: PresentedServicePlan; image: ImageSourcePropType }) {
  const icon: IconName = card.kind === 'supply' ? 'cart-outline' : card.kind === 'service' ? 'construct-outline' : 'cube-outline';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${card.kindLabel}，${card.title}，${card.statusLabel}`} onPress={() => router.push(`/plans/${card.id}` as never)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.cardVisual}>
        <Image source={image} resizeMode="cover" style={styles.cardImage} />
        <View style={styles.cardBadge}><Ionicons name={icon} size={14} color="#FFFFFF" /><Text style={styles.cardBadgeText}>{card.kindLabel}</Text></View>
      </View>
      <View style={styles.cardBody}>
        <Text numberOfLines={1} style={styles.cardTitle}>{card.title}</Text>
        <Text numberOfLines={2} style={styles.cardSummary}>{card.summary}</Text>
        <View style={styles.cardFooter}><Text numberOfLines={1} style={styles.cardStatus}>{card.statusLabel}</Text><View style={styles.cardAction}><Text style={styles.cardActionText}>{card.actionLabel}</Text><Ionicons name="chevron-forward" size={13} color={colors.text} /></View></View>
      </View>
    </Pressable>
  );
}

function EditorialCard({ card }: { card: EditorialServiceCard }) {
  const icon: IconName = card.kind === 'supply' ? 'cart-outline' : card.kind === 'service' ? 'construct-outline' : card.kind === 'nearby' ? 'location-outline' : 'cube-outline';
  const kindLabel = card.kind === 'supply' ? '补给' : card.kind === 'service' ? '服务' : card.kind === 'nearby' ? '附近' : '方案';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${kindLabel}，${card.title}，${card.meta}`} onPress={() => router.push(card.path as never)} style={({ pressed }) => [styles.card, card.compact && styles.compactCard, pressed && styles.cardPressed]}>
    <View style={[styles.cardVisual, card.compact && styles.compactVisual]}><Image source={card.image} resizeMode="cover" style={styles.cardImage} /><View style={styles.cardBadge}><Ionicons name={icon} size={14} color="#FFFFFF" /><Text style={styles.cardBadgeText}>{kindLabel}</Text></View></View>
    <View style={[styles.cardBody, card.compact && styles.compactBody]}><Text numberOfLines={1} style={styles.cardTitle}>{card.title}</Text><Text numberOfLines={2} style={styles.cardSummary}>{card.subtitle}</Text>
      {!card.compact ? <View style={styles.tags}>{card.tags.slice(0, 2).map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View> : null}
      <View style={styles.cardFooter}><Text numberOfLines={2} style={styles.cardMeta}>{card.meta}</Text>{card.compact ? <View style={styles.roundAction}><Ionicons name="add" size={20} color={colors.text} /></View> : <View style={styles.cardAction}><Text style={styles.cardActionText}>{card.action}</Text><Ionicons name="chevron-forward" size={13} color={colors.text} /></View>}</View>
    </View>
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
  headingRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { ...typography.pageTitle, color: colors.text },
  headingActions: { flexDirection: 'row', alignItems: 'center' },
  headingAction: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm },
  headingActionText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  headingDivider: { width: 1, height: 20, marginHorizontal: 3, backgroundColor: colors.border },
  headingIconAction: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  headingIconActionSelected: { backgroundColor: '#ECEBE7' },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: 10 },
  clearButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  kindFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.md },
  kindChip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  kindChipSelected: { backgroundColor: colors.text, borderColor: colors.text },
  kindChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  kindChipTextSelected: { color: '#FFFFFF' },
  sectionTabs: { minHeight: 52, flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.md, padding: 3, borderRadius: radius.pill, backgroundColor: '#EDEDEB' },
  sectionTab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  sectionTabSelected: { backgroundColor: colors.surface, shadowColor: '#524B42', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 1 },
  sectionTabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  sectionTabTextSelected: { color: colors.text, fontWeight: '800' },
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  muted: { ...typography.body, color: colors.textSecondary },
  stateSurface: { marginTop: spacing.sm },
  groupTitle: { ...typography.section, color: colors.text, fontSize: 17, lineHeight: 23, marginBottom: spacing.sm },
  groupTitleSpaced: { marginTop: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', rowGap: spacing.md },
  card: { width: '48.4%', overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: '#625A50', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 7, elevation: 2 },
  compactCard: { minHeight: 0 },
  cardPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  cardVisual: { height: 112, backgroundColor: '#DEDCD6' },
  compactVisual: { height: 82 },
  cardImage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  cardBadge: { position: 'absolute', top: spacing.sm, left: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.md, backgroundColor: 'rgba(25,27,26,0.82)' },
  cardBadgeText: { color: '#FFFFFF', fontSize: 12, lineHeight: 17, fontWeight: '800' },
  cardBody: { minHeight: 174, padding: spacing.md },
  compactBody: { minHeight: 132 },
  cardTitle: { ...typography.bodyStrong, color: colors.text },
  cardSummary: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: 4, minHeight: 36 },
  tags: { minHeight: 24, flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: spacing.xs },
  tag: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7, backgroundColor: '#F0F0EE', overflow: 'hidden' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, marginTop: spacing.md },
  cardStatus: { color: colors.primary, fontSize: 11, lineHeight: 16, fontWeight: '700', flex: 1 },
  cardMeta: { color: colors.textMuted, fontSize: 11, lineHeight: 16, flex: 1 },
  cardAction: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  cardActionText: { color: colors.text, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  roundAction: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  publishGrid: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  publishItem: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  publishIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.accentSoft },
  publishCopy: { flex: 1 }, publishTitle: { ...typography.bodyStrong, color: colors.text }, publishDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  publishNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successSoft },
  boundary: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successSoft },
  boundaryText: { ...typography.caption, color: colors.textSecondary, lineHeight: 19, flex: 1 },
  pressed: { opacity: 0.72 },
});
