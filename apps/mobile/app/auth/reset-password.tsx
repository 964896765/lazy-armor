import { useMutation } from '@tanstack/react-query';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { api } from '../../src/api';
import { authError } from '../../src/auth-error';
import { useAuthStore } from '../../src/auth-store';
import { AuthPage, styles } from './login';
export default function ResetPasswordPage() {
 const {token}=useLocalSearchParams<{token?:string}>();
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const valid=Boolean(typeof token==='string'&&token.length>=32&&password.length>=10&&password===confirm);
 const reset=useMutation({
  mutationFn:()=>api('/auth/reset-password',undefined,{method:'POST',body:JSON.stringify({token,newPassword:password})}),
  onSuccess:async()=>{setPassword('');setConfirm('');await useAuthStore.getState().clear();router.replace('/auth/password-login' as never);},
 });
 return <AuthPage title="重置密码" subtitle="重置后所有设备会退出，请使用新密码登录" backHref="/auth/password-login">
  {!token?<><Text style={styles.error}>缺少恢复链接，请重新申请重置邮件。</Text><Link href={'/auth/forgot-password' as never} style={styles.textLink}>重新申请</Link></>:<>
   <TextInput accessibilityLabel="恢复新密码" placeholder="新密码，至少 10 位" style={styles.input} secureTextEntry autoComplete="new-password" autoCapitalize="none" autoCorrect={false} maxLength={128} value={password} onChangeText={setPassword} editable={!reset.isPending}/>
   <TextInput accessibilityLabel="确认恢复密码" placeholder="再次输入新密码" style={styles.input} secureTextEntry autoComplete="new-password" autoCapitalize="none" autoCorrect={false} maxLength={128} value={confirm} onChangeText={setConfirm} editable={!reset.isPending}/>
   {confirm&&confirm!==password?<Text style={styles.error}>两次输入的密码不一致。</Text>:null}
   {reset.isError?<Text style={styles.error}>{authError(reset.error)} 恢复链接失效时请重新申请。</Text>:null}
   <Pressable accessibilityRole="button" disabled={!valid||reset.isPending} style={[styles.submit,(!valid||reset.isPending)&&styles.submitDisabled]} onPress={()=>reset.mutate()}><Text style={styles.submitText}>{reset.isPending?'保存中…':'重置并重新登录'}</Text></Pressable>
  </>}
 </AuthPage>;
}
