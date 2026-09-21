import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../src/design';
import { RuntimeDetailScreen, RuntimeSection, RuntimeText } from '../src/runtime-details-ui';

const sections = [
  { key: 'permissions', title: '数据与连接权限', detail: '查看已授权的范围，以及哪些连接需要重新授权', icon: 'key-outline' as const, route: '/permissions' },
  { key: 'approvals', title: '执行审批', detail: '重要动作由你确认；未确认时不会继续执行', icon: 'hand-left-outline' as const, route: '/approvals' },
  { key: 'devices', title: '可信设备', detail: '查看已信任或已撤销的手机', icon: 'phone-portrait-outline' as const, route: '/connections/trusted-devices' },
  { key: 'automation', title: '自动化安全', detail: '了解风险等级与执行边界', icon: 'shield-checkmark-outline' as const, route: '/automation-safety' },
  { key: 'audit', title: '安全记录', detail: '查看重要操作与审计记录', icon: 'reader-outline' as const, route: '/security-activity' },
];

export default function SecurityCenterPage() {
  return <RuntimeDetailScreen title="安全中心" subtitle="你始终掌握授权、审批、设备和数据边界" onBack={() => router.back()}>
    <RuntimeSection title="你的控制权"><View style={styles.list}>{sections.map((section) => <Pressable accessibilityRole="button" key={section.key} onPress={() => router.push(section.route as never)} style={styles.row}><View style={styles.icon}><Ionicons name={section.icon} size={19} color={colors.primary} /></View><View style={styles.copy}><Text style={styles.title}>{section.title}</Text><Text style={styles.detail}>{section.detail}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>)}</View></RuntimeSection>
    <RuntimeSection title="隐私与数据"><Pressable accessibilityRole="button" onPress={() => router.push('/privacy-center' as never)} style={styles.row}><View style={styles.icon}><Ionicons name="lock-closed-outline" size={19} color={colors.primary} /></View><View style={styles.copy}><Text style={styles.title}>隐私中心</Text><Text style={styles.detail}>查看数据来源、保留、删除和 AI 使用边界</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable></RuntimeSection>
    <View style={styles.note}><RuntimeText>页面只读取现有权限与审计数据。打开安全中心不会授予能力，也不会执行任何外部动作。</RuntimeText></View>
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm }, row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: spacing.md },
  icon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1 }, title: { ...typography.bodyStrong, color: colors.text }, detail: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },
  note: { marginTop: spacing.xl, paddingHorizontal: spacing.sm },
});
