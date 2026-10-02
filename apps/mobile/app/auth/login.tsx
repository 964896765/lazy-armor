import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, resolveAppEnv } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { normalizeLoginIdentifier } from '../../src/login-identifier';
import type { SessionTokens } from '../../src/secure-token-store';

type LoginMode = 'phone' | 'email';

export default function LoginPage() {
  const setSession = useAuthStore((state) => state.setSession);
  const [mode, setMode] = useState<LoginMode>('phone');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const login = useMutation({
    mutationFn: () => api<SessionTokens>('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: normalizeLoginIdentifier(email, resolveAppEnv()), password }) }),
    onSuccess: async (tokens) => { await setSession(tokens, { onboardingRequired: true }); router.replace('/onboarding' as never); },
  });
  return <AuthPage title={mode === 'phone' ? '你的手机号码是？' : '使用邮箱登录'} subtitle={mode === 'phone' ? '目前支持中国大陆手机号' : '输入已注册的邮箱和密码'}>
    <View style={styles.modeTabs}><Pressable onPress={() => setMode('phone')} style={[styles.modeTab, mode === 'phone' && styles.modeTabActive]}><Text style={[styles.modeText, mode === 'phone' && styles.modeTextActive]}>手机号</Text></Pressable><Pressable onPress={() => setMode('email')} style={[styles.modeTab, mode === 'email' && styles.modeTabActive]}><Text style={[styles.modeText, mode === 'email' && styles.modeTextActive]}>邮箱</Text></Pressable></View>
    {mode === 'phone' ? <>
      <View style={styles.phoneField}><Text style={styles.countryCode}>+86</Text><View style={styles.verticalRule} /><TextInput style={styles.phoneInput} accessibilityLabel="手机号码" keyboardType="phone-pad" autoComplete="tel" maxLength={11} placeholder="请输入手机号码" placeholderTextColor="#85909D" value={phone} onChangeText={setPhone} /></View>
      <Text style={styles.notice}>短信服务尚未配置，暂时不能发送真实验证码。请切换到邮箱登录。</Text>
      <Pressable disabled style={[styles.submit, styles.submitDisabled]}><Text style={styles.submitDisabledText}>发送验证码</Text></Pressable>
    </> : <>
      <TextInput style={styles.input} accessibilityLabel="邮箱" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="邮箱地址" placeholderTextColor="#85909D" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} accessibilityLabel="密码" autoComplete="current-password" secureTextEntry placeholder="密码" placeholderTextColor="#85909D" value={password} onChangeText={setPassword} />
      {login.isError ? <Text style={styles.error}>没有登录成功，请检查邮箱和密码后重试。</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => login.mutate()} disabled={login.isPending || !email.trim() || !password} style={[styles.submit, (login.isPending || !email.trim() || !password) && styles.submitDisabled]}><Text style={[styles.submitText, (login.isPending || !email.trim() || !password) && styles.submitDisabledText]}>{login.isPending ? '登录中…' : '登录'}</Text></Pressable>
      <Link href={'/auth/forgot-password' as never} style={styles.textLink}>忘记密码？</Link>
    </>}
    <View style={styles.footer}><Text style={styles.footerText}>第一次使用？</Text><Link href={'/auth/register' as never} style={styles.strongLink}>创建账号</Link></View>
  </AuthPage>;
}

export function AuthPage({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <SafeAreaView style={styles.safeArea}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={27} color="#546475" /></Pressable>
    <View style={styles.mark}><View style={styles.dot} /><View style={styles.dot} /></View>
    <Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text>
    <View style={styles.form}>{children}</View>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

export const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'transparent' }, flex: { flex: 1 }, content: { flexGrow: 1, paddingHorizontal: 30, paddingTop: 12, paddingBottom: 34 }, back: { width: 48, height: 48, marginLeft: -8, alignItems: 'center', justifyContent: 'center' }, mark: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 88 }, dot: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.92)' }, title: { marginTop: 42, color: '#202A36', fontSize: 30, lineHeight: 40, fontWeight: '700', textAlign: 'center' }, subtitle: { marginTop: 8, color: '#687584', fontSize: 15, lineHeight: 22, textAlign: 'center' }, form: { gap: 12, marginTop: 34 },
  modeTabs: { flexDirection: 'row', alignSelf: 'center', padding: 3, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.55)' }, modeTab: { minWidth: 86, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, modeTabActive: { backgroundColor: 'rgba(255,255,255,0.95)' }, modeText: { color: '#687584', fontSize: 15 }, modeTextActive: { color: '#202A36', fontWeight: '700' },
  phoneField: { minHeight: 60, flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingHorizontal: 18, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)' }, countryCode: { color: '#29323D', fontSize: 20, fontWeight: '600' }, verticalRule: { width: StyleSheet.hairlineWidth, height: 31, marginHorizontal: 16, backgroundColor: '#C8D0D9' }, phoneInput: { flex: 1, color: '#202A36', fontSize: 18 }, input: { minHeight: 58, color: '#202A36', fontSize: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.95)', backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 17, paddingHorizontal: 18 }, fieldLabel: { color: '#26313D', fontSize: 15, fontWeight: '700', marginTop: 4 },
  notice: { color: '#6A7582', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 4 }, error: { color: '#B83B45', fontSize: 14, lineHeight: 20 }, submit: { minHeight: 54, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderRadius: 16, backgroundColor: '#25282E' }, submitDisabled: { backgroundColor: 'rgba(121,132,145,0.35)' }, submitText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' }, submitDisabledText: { color: 'rgba(255,255,255,0.76)', fontSize: 17, fontWeight: '700' }, textLink: { color: '#277EAF', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 8 }, footer: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 15 }, footerText: { color: '#687584', fontSize: 14 }, strongLink: { color: '#277EAF', fontSize: 14, fontWeight: '700' },
  action: { marginTop: 10 }, success: { color: '#38576D', fontSize: 15, lineHeight: 22 }, infoBlock: { borderLeftWidth: 3, borderLeftColor: '#4C9CC7', paddingLeft: 12 }, infoTitle: { color: '#26313D', fontSize: 15, fontWeight: '700' }, infoCopy: { color: '#687584', fontSize: 14, lineHeight: 21, marginTop: 3 },
});
