import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { workspaceColors as colors, radius, spacing, typography } from '../../src/design';

type IconName = ComponentProps<typeof Ionicons>['name'];
interface Profile { displayName: string; status: string }

export default function Me() {
  const token = useAuthStore((store) => store.token);
  const clearSession = useAuthStore((store) => store.clear);
  const profile = useQuery({ queryKey: ['me', token], queryFn: () => api<Profile>('/me', token), enabled: Boolean(token) });
  const name = profile.data?.displayName ?? (token ? '我的账号' : '还没有登录');
  const loading = profile.isLoading;

  function confirmLogout() { Alert.alert('退出当前账号？', '这只会清除本机登录状态，不会删除计划、事实或记录。', [{ text: '取消', style: 'cancel' }, { text: '退出登录', style: 'destructive', onPress: async () => { await clearSession(); router.replace('/auth/login' as Href); } }]); }

  return <SafeAreaView edges={[]} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>我的</Text>
    <View style={styles.profileTop}><View style={styles.avatar}><Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase() || '我'}</Text></View><View style={styles.profileCopy}><Text style={styles.profileName}>{name}</Text><Text style={styles.profileMeta}>{token ? '从从容容，游刃有余' : '登录后开始使用'}</Text><Text style={styles.profileSummary}>{token ? profile.data?.status || '账号状态正常' : '尚未登录'}</Text></View>{loading ? <ActivityIndicator color={colors.primary} /> : <Pressable accessibilityRole="button" onPress={() => router.push('/profile' as never)} style={styles.profileState}><Text style={styles.profileStateText}>编辑资料</Text><Ionicons name="chevron-forward" size={16} color={colors.primary} /></Pressable>}</View>

    <Section title="账号"><MenuRow icon="person-outline" tone="green" title="账号与验证" detail="登录方式及身份验证" onPress={() => router.push('/security-center' as never)} /><MenuRow icon="phone-portrait-outline" tone="blue" title="登录与设备" detail="当前登录、会话及账号可信设备" onPress={() => router.push('/feature-placeholder?feature=login-devices' as never)} /><MenuRow icon="shield-outline" tone="purple" title="个人隐私设置" detail="个人信息使用与隐私选择" onPress={() => router.push('/feature-placeholder?feature=personal-privacy' as never)} last /></Section>
    <Section title="偏好与设置"><MenuRow icon="settings-outline" tone="green" title="偏好设置" detail="内容及界面偏好" onPress={() => router.push('/feature-placeholder?feature=preferences' as never)} /><MenuRow icon="moon-outline" tone="green" title="显示与提醒" detail="显示方式、免打扰及通知偏好" onPress={() => router.push('/notification-settings' as never)} /><MenuRow icon="hardware-chip-outline" tone="green" title="AI 助手习惯" detail="对话风格与个人交互偏好" onPress={() => router.push('/feature-placeholder?feature=ai-habits' as never)} last /></Section>
    <Section title="支持"><MenuRow icon="help-circle-outline" tone="green" title="帮助与反馈" detail="使用帮助和问题反馈" onPress={() => router.push('/feature-placeholder?feature=help' as never)} /><MenuRow icon="information-circle-outline" tone="green" title="关于懒人装甲" detail="版本、协议及产品信息" onPress={() => router.push('/feature-placeholder?feature=about' as never)} last /></Section>
    {token ? <Pressable accessibilityRole="button" onPress={confirmLogout} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}><Ionicons name="log-out-outline" size={18} color={colors.textSecondary} /><Text style={styles.logoutText}>退出登录</Text></Pressable> : null}
  </ScrollView></SafeAreaView>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.menu}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.sectionDivider} />{children}</View>; }
function MenuRow({ icon, tone, title, detail, status, onPress, last = false }: { icon: IconName; tone: 'green' | 'orange' | 'blue' | 'purple'; title: string; detail: string; status?: string; onPress?: () => void; last?: boolean }) { return <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.pressed]}><View style={[styles.rowIcon, styles[`icon_${tone}`]]}><Ionicons name={icon} size={21} color={colors.text} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text numberOfLines={1} style={styles.rowDetail}>{detail}</Text></View>{status ? <Text style={styles.rowStatus}>{status}</Text> : null}{onPress ? <Ionicons name="chevron-forward" size={17} color={colors.textMuted} /> : null}</Pressable>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 92 }, pressed: { opacity: 0.68 }, title: { ...typography.pageTitle, color: colors.text, marginBottom: spacing.sm }, profileTop: { minHeight: 118, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.md, marginBottom: spacing.md }, avatar: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: 36, backgroundColor: colors.brandSoft }, avatarText: { color: '#FFFFFF', fontSize: 28, fontWeight: '700' }, profileCopy: { flex: 1, minWidth: 0 }, profileName: { ...typography.title, color: colors.text, fontSize: 20 }, profileMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 3 }, profileSummary: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 3 }, profileState: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.successSoft }, profileStateText: { fontSize: 12, color: colors.primary },
  sectionTitle: { ...typography.section, color: colors.text, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm }, sectionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.md, backgroundColor: colors.border }, menu: { overflow: 'hidden', marginBottom: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, row: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8 }, rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, rowIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 }, icon_green: { backgroundColor: colors.accentSoft }, icon_orange: { backgroundColor: colors.accentSoft }, icon_blue: { backgroundColor: colors.accentSoft }, icon_purple: { backgroundColor: colors.accentSoft }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { ...typography.bodyStrong, color: colors.text }, rowDetail: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 1 }, rowStatus: { fontSize: 11, color: colors.textSecondary }, logout: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: spacing.md, borderRadius: radius.pill, backgroundColor: colors.accentSoft }, logoutText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
});
