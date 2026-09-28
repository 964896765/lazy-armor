import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/auth-store';
import { colors, radius, spacing, typography } from '../src/design';

type IconName = ComponentProps<typeof Ionicons>['name'];

const SETUP_ITEMS: readonly { step: string; icon: IconName; tone: 'green' | 'orange'; title: string; detail: string; route: string }[] = [
  { step: '1 / 3', icon: 'notifications-outline', tone: 'green', title: '通知与提醒', detail: '接收计划提醒与重要结果', route: '/notification-settings' },
  { step: '2 / 3', icon: 'server-outline', tone: 'orange', title: '连接数据来源', detail: '让账目、快递、设备等信息自动进入', route: '/connections' },
  { step: '3 / 3', icon: 'shield-checkmark-outline', tone: 'green', title: '安全与保护', detail: '登录验证、可信设备与访问记录', route: '/security-center' },
];

export default function OnboardingPage() {
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);

  const finish = async (destination = '/') => {
    await completeOnboarding();
    router.replace(destination as never);
  };

  return <SafeAreaView style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <View pointerEvents="none" style={styles.decorLeft} /><View pointerEvents="none" style={styles.decorRight} />
    <View style={styles.logoWrap}><Image source={require('../assets/icon.png')} style={styles.logo} /></View>
    <Text style={styles.title}>欢迎来到懒人装甲</Text>
    <Text style={styles.subtitle}>先完成这 3 项设置，让计划真正运行起来</Text>

    <View style={styles.cards}>{SETUP_ITEMS.map((item) => <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`${item.title}，${item.detail}`} onPress={() => void finish(item.route)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.icon, item.tone === 'orange' && styles.iconOrange]}><Ionicons name={item.icon} size={29} color={colors.primary} /></View>
      <View style={styles.cardCopy}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardDetail}>{item.detail}</Text></View>
      <View style={styles.cardEnd}><Text style={styles.step}>{item.step}</Text><Ionicons name="chevron-forward" size={22} color={colors.textMuted} /></View>
    </Pressable>)}</View>

    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={() => void finish()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}><Text style={styles.secondaryText}>稍后设置</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void finish()} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}><Text style={styles.primaryText}>进入首页</Text><Ionicons name="arrow-forward" size={21} color="#FFFFFF" /></Pressable>
    </View>
    <Text style={styles.hint}>你也可以在“我的”中随时继续设置</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FBFAF7' }, content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl, paddingVertical: spacing.xxl, overflow: 'hidden' },
  decorLeft: { position: 'absolute', width: 250, height: 250, left: -190, top: 20, borderRadius: 125, backgroundColor: '#F2EDE4' }, decorRight: { position: 'absolute', width: 260, height: 260, right: -180, bottom: -80, borderRadius: 130, backgroundColor: '#E8EEE5' },
  logoWrap: { width: 128, height: 104, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 38, backgroundColor: '#FFFFFF', shadowColor: '#506452', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 18, elevation: 3 }, logo: { width: 142, height: 142 },
  title: { marginTop: spacing.xl, color: colors.text, fontSize: 30, lineHeight: 40, fontWeight: '700', textAlign: 'center', letterSpacing: -0.5 }, subtitle: { marginTop: spacing.sm, color: '#718675', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  cards: { gap: spacing.md, marginTop: spacing.xxl }, card: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.94)', shadowColor: '#625A50', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 1 }, icon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.accentSoft }, iconOrange: { backgroundColor: '#F8F0DF' }, cardCopy: { flex: 1, minWidth: 0 }, cardTitle: { ...typography.title, color: colors.text }, cardDetail: { ...typography.body, color: colors.textSecondary, marginTop: 4 }, cardEnd: { alignItems: 'center', gap: spacing.sm }, step: { ...typography.caption, color: colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: '#EEF2E9' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl }, secondary: { flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.72)' }, secondaryText: { ...typography.body, color: colors.text }, primary: { flex: 1.15, minHeight: 54, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primary }, primaryText: { ...typography.bodyStrong, color: '#FFFFFF' }, hint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg }, pressed: { opacity: 0.7 },
});
