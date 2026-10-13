import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { api, resolveAppEnv } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { authError } from '../../src/auth-error';
import { normalizeLoginIdentifier } from '../../src/login-identifier';
import type { SessionTokens } from '../../src/secure-token-store';
import { AuthPage, styles } from './login';
import { fetchLoginMethods } from '../../src/auth-methods';
import { SegmentedControl } from '../../src/consumer-ui';

export default function PasswordLoginPage() {
  const [identifier, setIdentifier] = useState(''), [password, setPassword] = useState('');
  const [kind,setKind]=useState<'email'|'phone'>('email');
  const methods=useQuery({queryKey:['login-methods'],queryFn:fetchLoginMethods,staleTime:60000});
  const phoneEnabled=methods.data?.passwordIdentifiers?.includes('phone')??false;
  const setSession = useAuthStore(state => state.setSession);
  const login = useMutation({
    mutationFn: () => api<SessionTokens>('/auth/login', undefined, { method: 'POST', body: JSON.stringify(kind==='email'?{email:normalizeLoginIdentifier(identifier,resolveAppEnv()),password}:{kind,identifier:identifier.trim(),password}) }),
    onSuccess: async tokens => { await setSession(tokens); router.replace('/schedule' as never); },
  });
  const disabled = login.isPending || !identifier.trim() || !password;
  return <AuthPage title={phoneEnabled?'密码登录':'邮箱密码登录'} subtitle={phoneEnabled?'已验证的登录方式共用同一账号密码':'使用已有邮箱账号与密码'} backHref="/auth/login">
    {phoneEnabled?<SegmentedControl value={kind} options={[{value:'email',label:'邮箱'},{value:'phone',label:'手机号'}]} onChange={value=>{if(login.isPending)return;setKind(value);setIdentifier('');setPassword('');login.reset();}}/>:null}
    <TextInput style={styles.input} accessibilityLabel={kind==='email'?'邮箱账号':'手机号账号'} placeholder={kind==='email'?'邮箱地址':'已绑定的中国大陆手机号'} value={identifier} onChangeText={setIdentifier}
      autoCapitalize="none" autoCorrect={false} autoComplete={kind==='email'?'email':'tel'} keyboardType={kind==='email'?'email-address':'phone-pad'} maxLength={kind==='email'?320:14} editable={!login.isPending} />
    {kind==='phone'?<Text style={styles.notice}>仅已绑定并验证的手机号可使用本账号密码。此入口不会创建新账号。</Text>:null}
    <TextInput style={styles.input} accessibilityLabel="密码" placeholder="密码" value={password} onChangeText={setPassword}
      secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" maxLength={128} editable={!login.isPending} />
    {login.isError ? <Text style={styles.error}>{authError(login.error)}</Text> : null}
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => login.mutate()} style={[styles.submit, disabled && styles.submitDisabled]}><Text style={styles.submitText}>{login.isPending ? '登录中…' : '登录'}</Text></Pressable>
    <Link href={'/auth/login' as never} style={styles.textLink}>使用验证码登录</Link>
    <Link href={'/auth/forgot-password' as never} style={styles.textLink}>忘记密码</Link>
    <Text style={styles.notice}>新用户请使用验证码登录。登录后可在账号与验证中设置密码。</Text>
  </AuthPage>;
}
