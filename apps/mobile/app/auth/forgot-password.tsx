import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { api } from '../../src/api';
import { authError } from '../../src/auth-error';
import { AuthPage, styles } from './login';
import { fetchLoginMethods } from '../../src/auth-methods';
export default function ForgotPasswordPage() {
 const [email,setEmail]=useState('');
 const methods=useQuery({queryKey:['login-methods'],queryFn:fetchLoginMethods,staleTime:60000});
 const recovery=methods.data?.passwordRecovery;
 const request=useMutation({mutationFn:()=>api('/auth/forgot-password',undefined,{method:'POST',body:JSON.stringify({email:email.trim()})})});
 return <AuthPage title="找回密码" subtitle={recovery?.emailAliases?'任一已验证的登录邮箱都可恢复同一账号密码':'使用原账号已验证的邮箱申请恢复'} backHref="/auth/password-login">
  <TextInput accessibilityLabel="恢复邮箱" placeholder={recovery?.emailAliases?'任一已验证的登录邮箱':'原账号已验证的邮箱'} style={styles.input} value={email} onChangeText={value=>{setEmail(value);request.reset();}} editable={!request.isPending} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={320}/>
  <Text style={styles.notice}>未验证邮箱的旧账号需要支持核对，请勿重新注册来替代原账号。</Text>
  {recovery?.emailAliases?<Text style={styles.notice}>每次成功申请会使此前的恢复链接失效。密码是可选功能，没有设置密码时可直接使用验证码登录。</Text>:null}
  {recovery?.available===false?<Text style={styles.notice}>重置邮件暂不可用，可使用已验证邮箱的验证码登录。</Text>:null}
  {methods.isError?<Pressable accessibilityRole="button" onPress={()=>void methods.refetch()}><Text style={styles.error}>{authError(methods.error)} · 点击重试</Text></Pressable>:null}
  {request.isError?<Text style={styles.error}>{authError(request.error)}</Text>:null}
  {request.isSuccess?<Text style={styles.success}>请求已提交。若邮箱已验证并配置密码，系统会尝试发送重置邮件。未收到时，可选择邮箱验证码登录或联系支持。</Text>:null}
  <Pressable accessibilityRole="button" disabled={!email.trim()||request.isPending||methods.isPending||methods.isError||recovery?.available===false} style={[styles.submit,(!email.trim()||request.isPending||recovery?.available===false)&&styles.submitDisabled]} onPress={()=>request.mutate()}><Text style={styles.submitText}>{request.isPending?'提交中…':'申请重置邮件'}</Text></Pressable>
  <Link href={'/auth/login' as never} style={styles.textLink}>使用邮箱验证码登录</Link>
 </AuthPage>;
}
