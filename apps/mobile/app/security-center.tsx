import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../src/design';
import { RuntimeDetailScreen, RuntimeSection } from '../src/runtime-details-ui';

const sections = [
  { key: 'identity', title: '身份验证', detail: '手机号、邮箱与身份验证状态', icon: 'person-circle-outline' as const, status: '已验证' },
  { key: 'password', title: '登录密码', detail: '验证旧密码后设置新的登录密码', icon: 'key-outline' as const, route: '/change-password' },
];

export default function SecurityCenterPage() {
  return <RuntimeDetailScreen title="账号与验证" subtitle="管理登录方式与身份验证；登录会话和可信设备由“登录与设备”统一承接。" onBack={() => router.back()}>
    <RuntimeSection title="登录与验证"><View style={styles.list}>{sections.map((section) => <Pressable accessibilityRole={section.route ? 'button' : undefined} disabled={!section.route} key={section.key} onPress={() => section.route && router.push(section.route as never)} style={styles.row}><View style={styles.icon}><Ionicons name={section.icon} size={21} color={colors.primary} /></View><View style={styles.copy}><Text style={styles.title}>{section.title}</Text><Text style={styles.detail}>{section.detail}</Text></View>{section.status ? <Text style={styles.status}>{section.status}</Text> : null}{section.route ? <Ionicons name="chevron-forward" size={19} color={colors.textMuted} /> : null}</Pressable>)}</View></RuntimeSection>
  </RuntimeDetailScreen>;
}

const styles = StyleSheet.create({
  list: { overflow: 'hidden', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }, row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, padding: spacing.md },
  icon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1 }, title: { ...typography.bodyStrong, color: colors.text }, detail: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },
  status: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
