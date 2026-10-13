import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { api } from '../../src/api';
import { authError } from '../../src/auth-error';
import { AuthPage, styles } from './login';
export default function ForgotPasswordPage() {
 const [email,setEmail]=useState('');
 const request=useMutation({mutationFn:()=>api('/auth/forgot-password',undefined,{method:'POST',body:JSON.stringify({email:email.trim()})})});
 return <AuthPage title="找回密码" subtitle="仅已验证邮箱可作为自动恢复渠道" backHref="/auth/password-login">
  <TextInput accessibilityLabel="恢复邮箱" placeholder="账号的已验证邮箱" style={styles.input} value={email} onChangeText={value=>{setEmail(value);request.reset();}} editable={!request.isPending} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={320}/>
  <Text style={styles.notice}>未验证邮箱的旧账号需要支持核对，请勿重新注册来替代原账号。</Text>
  {request.isError?<Text style={styles.error}>{authError(request.error)}</Text>:null}
  {request.isSuccess?<Text style={styles.success}>请求已提交。若邮箱已验证并配置密码，系统会尝试发送重置邮件。未收到时，可选择邮箱验证码登录或联系支持。</Text>:null}
  <Pressable accessibilityRole="button" disabled={!email.trim()||request.isPending} style={[styles.submit,(!email.trim()||request.isPending)&&styles.submitDisabled]} onPress={()=>request.mutate()}><Text style={styles.submitText}>{request.isPending?'提交中…':'申请重置邮件'}</Text></Pressable>
  <Link href={'/auth/login' as never} style={styles.textLink}>使用邮箱验证码登录</Link>
 </AuthPage>;
}
