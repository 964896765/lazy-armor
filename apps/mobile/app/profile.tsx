import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';

type IconName = ComponentProps<typeof Ionicons>['name'];
interface Profile { displayName: string; email?: string | null; avatar?: string | null; status: string }

export default function ProfilePage() {
  const token = useAuthStore((state) => state.token);
  const clearSession = useAuthStore((state) => state.clear);
  const profile = useQuery({ queryKey: ['me', token], queryFn: () => api<Profile>('/me', token), enabled: Boolean(token) });
  const name = profile.data?.displayName ?? (token ? '我的账号' : '还没有登录');
  const avatar = usableImage(profile.data?.avatar) ? profile.data?.avatar : null;

  function confirmLogout() {
    Alert.alert('退出当前账号？', '这只会清除本机登录状态，不会删除计划、事实或记录。', [
      { text: '取消', style: 'cancel' },
      { text: '退出登录', style: 'destructive', onPress: async () => { await clearSession(); router.replace('/auth/login' as Href); } },
    ]);
  }

  return <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={styles.headerButton}><Ionicons name="chevron-back" size={25} color="#172033" /></Pressable><Text style={styles.headerTitle}>我的</Text><View style={styles.headerButton} /></View>
    <Pressable accessibilityRole="button" accessibilityLabel="编辑个人资料" onPress={() => router.push('/profile-edit' as never)} style={styles.identity}>
      <View style={styles.avatar}>{avatar ? <Image source={{ uri: avatar }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase() || '我'}</Text>}</View>
      <View style={{flex:1,minWidth:0}}>{profile.isLoading ? <ActivityIndicator color="#2B75D6" /> : <><Text numberOfLines={1} style={styles.name}>{name}</Text><Text numberOfLines={1} style={styles.email}>{profile.data?.email || (token ? '个人资料与账号' : '登录后开始使用')}</Text></>}</View>
      <Ionicons name="chevron-forward" size={18} color="#526178" />
    </Pressable>
    <View style={styles.menu}>
      <MenuRow icon="person-outline" title="个人资料" detail="头像、昵称、简介、账号管理" onPress={() => router.push('/profile-edit' as never)} />
      <MenuRow icon="key-outline" title="账号与登录" detail="登录安全与账号管理" onPress={() => router.push('/security-center' as never)} />
      <MenuRow icon="phone-portrait-outline" title="设备安全" detail="已登录设备与撤销授权" onPress={() => router.push('/connected-devices' as never)} />
      <MenuRow icon="settings-outline" title="应用设置" detail="信息获取、提醒与后台运行" onPress={() => router.push('/settings' as never)} />
      <MenuRow icon="notifications-outline" title="通知" detail="提醒偏好" onPress={() => router.push('/notification-settings' as never)} />
      <MenuRow icon="shield-outline" title="自动化安全" detail="风险与审批偏好" onPress={() => router.push('/automation-safety' as never)} />
      <MenuRow icon="ribbon-outline" title="会员" detail="订阅与权益" onPress={() => router.push('/membership' as never)} />
      <MenuRow icon="shield-checkmark-outline" title="安全活动" detail="账号与系统通知" onPress={() => router.push('/system-notifications' as never)} />
      <MenuRow icon="sparkles-outline" title="AI 服务" detail="配置与连接检查" onPress={() => router.push('/ai-service' as never)} />
      <MenuRow icon="lock-closed-outline" title="数据与隐私" detail="隐私与数据管理" onPress={() => router.push('/feature-placeholder?feature=personal-privacy' as never)} />
      <MenuRow icon="color-palette-outline" title="主题与背景" detail="浅色 / 深色 / 背景图片" onPress={() => router.push('/feature-placeholder?feature=preferences' as never)} />
      <MenuRow icon="help-buoy-outline" title="帮助与反馈" detail="常见问题、问题反馈、功能建议" onPress={() => router.push('/feature-placeholder?feature=help' as never)} />
      <MenuRow icon="information-circle-outline" title="关于" detail="用户协议、隐私政策、版本信息" onPress={() => router.push('/feature-placeholder?feature=about' as never)} last />
    </View>
    {token ? <Pressable accessibilityRole="button" onPress={confirmLogout} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}><Ionicons name="log-out-outline" size={21} color="#E5484D" /><Text style={styles.logoutText}>退出登录</Text></Pressable> : null}
  </ScrollView></SafeAreaView>;
}

function MenuRow({ icon, title, detail, onPress, last = false }: { icon: IconName; title: string; detail: string; onPress: () => void; last?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.pressed]}><View style={styles.rowIcon}><Ionicons name={icon} size={20} color="#172033" /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text></View><Ionicons name="chevron-forward" size={20} color="#526178" /></Pressable>;
}

function usableImage(value?: string | null) { return Boolean(value && (/^https?:\/\//.test(value) || value.startsWith('data:image/'))); }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'transparent' }, content: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 20 }, pressed: { opacity: 0.66 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: '#172033', fontSize: 20, lineHeight: 28, fontWeight: '700' },
  identity: { flexDirection:'row', gap:14, alignItems: 'center', paddingVertical: 16 }, avatar: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26, borderWidth: 2, borderColor: 'rgba(255,255,255,0.82)', backgroundColor: 'rgba(229,237,245,0.86)' }, avatarImage: { width: 48, height: 48, borderRadius: 24 }, avatarText: { color: '#2B75D6', fontSize: 22, fontWeight: '700' }, camera: { position: 'absolute', right: -2, bottom: 1, width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.88)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(83,101,121,0.16)' }, name: { marginTop: 0, color: '#172033', fontSize: 18, lineHeight: 25, fontWeight: '700' }, email: { marginTop: 3, color: '#596579', fontSize: 14, lineHeight: 20, fontWeight: '500' },
  menu: { backgroundColor: 'transparent' }, row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 }, rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(104,122,144,0.12)' }, rowIcon: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { color: '#172033', fontSize: 15, lineHeight: 22, fontWeight: '600' }, rowDetail: { marginTop: 1, color: '#596579', fontSize: 13, lineHeight: 19, fontWeight: '500' },
  logout: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 18, borderRadius: 18, backgroundColor: 'rgba(255,236,237,0.76)' }, logoutText: { color: '#E5484D', fontSize: 15, fontWeight: '600' },
});
