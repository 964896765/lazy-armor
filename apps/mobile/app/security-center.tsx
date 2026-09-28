import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../src/design';
import { RuntimeDetailScreen, RuntimeSection, RuntimeText } from '../src/runtime-details-ui';

const sections = [
  { key: 'password', title: '修改密码', detail: '验证旧密码后设置新的登录密码', icon: 'key-outline' as const, route: '/change-password' },
  { key: 'devices', title: '可信设备', detail: '查看已验证或已撤销的登录设备', icon: 'phone-portrait-outline' as const, route: '/connections/trusted-devices' },
  { key: 'activity', title: '登录记录', detail: '查看登录与其他重要账号安全事件', icon: 'time-outline' as const, route: '/security-activity' },
];

export default function SecurityCenterPage() {
  return <RuntimeDetailScreen title="账号安全" subtitle="这里只管理账号登录本身，不再混入数据授权和数据安全设置。" onBack={() => router.back()}>
    <RuntimeSection title="账号保护"><View style={styles.list}>{sections.map((section) => <Pressable accessibilityRole="button" key={section.key} onPress={() => router.push(section.route as never)} style={styles.row}><View style={styles.icon}><Ionicons name={section.icon} size={21} color={colors.primary} /></View><View style={styles.copy}><Text style={styles.title}>{section.title}</Text><Text style={styles.detail}>{section.detail}</Text></View><Ionicons name="chevron-forward" size={19} color={colors.textMuted} /></Pressable>)}</View></RuntimeSection>
    <View style={styles.note}><RuntimeText>连接权限、AI 使用和数据保留统一放在“安全”中管理。</RuntimeText></View>
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm }, row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: spacing.md },
  icon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1 }, title: { ...typography.bodyStrong, color: colors.text }, detail: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },
  note: { marginTop: spacing.xl, paddingHorizontal: spacing.sm },
});
