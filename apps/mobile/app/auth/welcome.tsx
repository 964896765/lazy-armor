import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '../../src/design';

export default function WelcomePage() {
  return <SafeAreaView style={styles.safeArea}>
    <View pointerEvents="none" style={styles.decorLeft} /><View pointerEvents="none" style={styles.decorRight} />
    <View style={styles.content}>
      <View style={styles.logoWrap}><Image source={require('../../assets/icon.png')} style={styles.logo} /></View>
      <Text style={styles.brand}>懒人装甲</Text>
      <Text style={styles.tagline}>从从容容，游刃有余</Text>
      <View style={styles.rule} />
      <Text style={styles.copy}>用智能帮你减少重复的生活与工作琐事，{`\n`}把时间留给更重要的事。</Text>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/auth/login' as never)} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}><Ionicons name="mail-outline" size={24} color="#FFFFFF" /><Text style={styles.primaryText}>邮箱登录</Text><Ionicons name="chevron-forward" size={22} color="#FFFFFF" /></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/auth/register' as never)} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}><Ionicons name="person-add-outline" size={24} color={colors.text} /><Text style={styles.secondaryText}>创建账号</Text><Ionicons name="chevron-forward" size={22} color={colors.textMuted} /></Pressable>
      </View>

      <Text style={styles.terms}>继续使用即表示你同意 服务协议 和 隐私政策</Text>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FBFAF7', overflow: 'hidden' }, decorLeft: { position: 'absolute', width: 260, height: 260, left: -190, top: 10, borderRadius: 130, backgroundColor: '#F2EDE4' }, decorRight: { position: 'absolute', width: 280, height: 280, right: -190, bottom: -80, borderRadius: 140, backgroundColor: '#E8EEE5' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxxl, paddingVertical: spacing.xxl }, logoWrap: { width: 176, height: 144, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 50, backgroundColor: '#FFFFFF', shadowColor: '#506452', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.12, shadowRadius: 22, elevation: 4 }, logo: { width: 194, height: 194 },
  brand: { marginTop: spacing.xxl, color: colors.text, fontSize: 42, lineHeight: 52, fontWeight: '700', textAlign: 'center', letterSpacing: 2 }, tagline: { marginTop: spacing.sm, color: '#718675', fontSize: 19, lineHeight: 28, textAlign: 'center', letterSpacing: 5 }, rule: { width: 36, height: 3, alignSelf: 'center', marginTop: spacing.xl, borderRadius: 2, backgroundColor: '#BFCBAD' }, copy: { ...typography.body, color: colors.textSecondary, fontSize: 16, lineHeight: 25, textAlign: 'center', marginTop: spacing.lg },
  actions: { gap: spacing.md, marginTop: spacing.xxxl }, primary: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: colors.primary }, primaryText: { ...typography.title, color: '#FFFFFF', fontWeight: '600' }, secondary: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.8)' }, secondaryText: { ...typography.title, color: colors.text, fontWeight: '500' }, terms: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xxl }, pressed: { opacity: 0.7 },
});
