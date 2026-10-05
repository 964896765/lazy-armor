import { SegmentedControl } from '../../src/consumer-ui';
import { ConsumerPresentationMapper as presentation } from '../../src/consumer-presentation';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, resolveAppEnv } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { normalizeLoginIdentifier } from '../../src/login-identifier';
import type { SessionTokens } from '../../src/secure-token-store';

type LoginMode = 'phone' | 'email';

export default function LoginPage() {
 const setSession=useAuthStore(s=>s.setSession);
 const [mode,setMode]=useState<LoginMode>('phone');const [identifier,setIdentifier]=useState('');const [code,setCode]=useState('');
 const [localDelivery,setLocalDelivery]=useState(false);
 const [sentTo,setSentTo]=useState('');const [retryAt,setRetryAt]=useState(0);const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const request=useMutation({mutationFn:()=>api<{sent:boolean;retryAfterSeconds:number;delivery?:string}>('/auth/code/request',undefined,{method:'POST',body:JSON.stringify({kind:mode,identifier})}),onSuccess:result=>{if(result.sent){setLocalDelivery(result.delivery==='LOCAL_DEVELOPMENT');setSentTo(mode+':'+identifier.trim());setRetryAt(Date.now()+result.retryAfterSeconds*1000);}}});
 const login=useMutation({mutationFn:()=>api<SessionTokens & {firstLogin:boolean}>('/auth/code/verify',undefined,{method:'POST',body:JSON.stringify({kind:mode,identifier,code})}),onSuccess:async tokens=>{await setSession(tokens,{onboardingRequired:tokens.firstLogin});router.replace((tokens.firstLogin?'/onboarding':'/schedule') as never);}});
 const remaining=Math.max(0,Math.ceil((retryAt-now)/1000));
 const changeMode=(value:string)=>{setMode(value as LoginMode);setIdentifier('');setCode('');setSentTo('');request.reset();login.reset();};
 return <AuthPage title="验证码登录" subtitle="首次验证成功将自动创建账号">
  <SegmentedControl value={mode} options={[{value:'phone',label:'手机号'},{value:'email',label:'邮箱'}]} onChange={changeMode}/>
  <TextInput style={styles.input} accessibilityLabel={mode==='phone'?'手机号码':'邮箱'} keyboardType={mode==='phone'?'phone-pad':'email-address'} autoCapitalize="none" autoComplete={mode==='phone'?'tel':'email'} placeholder={mode==='phone'?'中国大陆手机号':'邮箱地址'} value={identifier} onChangeText={setIdentifier}/>
  <View style={{flexDirection:'row',gap:10,alignItems:'center'}}><TextInput style={[styles.input,{flex:1}]} accessibilityLabel="验证码" keyboardType="number-pad" autoComplete="sms-otp" maxLength={6} placeholder="6 位验证码" value={code} onChangeText={setCode}/><Pressable accessibilityRole="button" disabled={request.isPending||remaining>0||!identifier.trim()} onPress={()=>request.mutate()} style={{padding:10}}><Text style={styles.strongLink}>{request.isPending?'发送中…':remaining>0?remaining+' 秒后重试':'获取验证码'}</Text></Pressable></View>
  {sentTo===mode+':'+identifier.trim()?<Text style={styles.notice}>{localDelivery?'开发验证码已生成，请查看本地后端控制台。':'验证码已发送，请在 5 分钟内输入。'}</Text>:null}
  {request.isError||login.isError?<Text style={styles.error}>{presentation.error(request.error??login.error)}</Text>:null}
  <Pressable accessibilityRole="button" disabled={login.isPending||!identifier.trim()||!/^\d{6}$/.test(code)} onPress={()=>login.mutate()} style={[styles.submit,(login.isPending||!/^\d{6}$/.test(code))&&styles.submitDisabled]}><Text style={styles.submitText}>{login.isPending?'验证中…':'验证并登录'}</Text></Pressable>
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
