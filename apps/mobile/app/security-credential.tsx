import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { api } from '../src/api';
import { authError } from '../src/auth-error';
import { useAuthStore } from '../src/auth-store';
import { AuthPage, styles } from './auth/login';

export default function SecurityCredentialPage() {
  const { purpose } = useLocalSearchParams<{purpose?:string}>();
  const verifyEmail = purpose === 'verify-email';
  const token = useAuthStore(s=>s.token);
  const [email,setEmail]=useState(''), [password,setPassword]=useState(''), [confirm,setConfirm]=useState(''), [code,setCode]=useState('');
  const [retryAt,setRetryAt]=useState(0), [now,setNow]=useState(Date.now()), [delivery,setDelivery]=useState('');
  const client=useQueryClient();
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const base=verifyEmail?'/auth/identifiers/bind':'/auth/password/set';
  const request=useMutation({
    mutationFn:()=>api<{retryAfterSeconds:number;delivery?:string}>(base+'/request',token,{method:'POST',body:JSON.stringify({email,...(verifyEmail?{password}:{})})}),
    onSuccess:result=>{setRetryAt(Date.now()+result.retryAfterSeconds*1000);setDelivery(result.delivery==='LOCAL_DEVELOPMENT'?'开发验证码已生成，请查看本地后端控制台。':'验证码已发送到邮箱，5 分钟内有效。');},
  });
  const save=useMutation({
    mutationFn:()=>api(verifyEmail?base+'/confirm':base,token,{method:'POST',body:JSON.stringify({email,code,...(verifyEmail?{password}:{newPassword:password})})}),
    onSuccess:async()=>{setPassword('');setConfirm('');setCode('');await client.invalidateQueries({queryKey:['security-methods']});},
  });
  const busy=request.isPending||save.isPending;
  const remaining=Math.max(0,Math.ceil((retryAt-now)/1000));
  const valid=Boolean(email.trim()&&/^\d{6}$/.test(code)&&(verifyEmail?password.length>0:password.length>=10&&password===confirm));
  return <AuthPage title={verifyEmail?'验证已有账号邮箱':'设置可选密码'} subtitle={verifyEmail?'验证邮箱后，验证码与原密码将进入同一账号':'继续使用当前账号，无需重新注册'} backHref="/security-center">
    <TextInput accessibilityLabel="当前账号邮箱" placeholder="当前账号的邮箱地址" style={styles.input} value={email} editable={!busy&&!save.isSuccess} maxLength={320} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" onChangeText={value=>{setEmail(value);setCode('');setDelivery('');request.reset();save.reset();}} />
    <TextInput accessibilityLabel={verifyEmail?'当前密码':'新密码'} placeholder={verifyEmail?'当前账号的原密码':'新密码，至少 10 位'} secureTextEntry autoComplete={verifyEmail?'current-password':'new-password'} autoCapitalize="none" style={styles.input} value={password} editable={!busy&&!save.isSuccess} maxLength={128} onChangeText={setPassword} />
    {!verifyEmail?<TextInput accessibilityLabel="确认密码" placeholder="再次输入新密码" secureTextEntry autoComplete="new-password" style={styles.input} value={confirm} maxLength={128} editable={!busy&&!save.isSuccess} onChangeText={setConfirm}/>:null}
    <TextInput accessibilityLabel="邮箱验证码" placeholder="6 位邮箱验证码" style={styles.input} value={code} keyboardType="number-pad" maxLength={6} editable={!busy&&!save.isSuccess} onChangeText={setCode}/>
    <Pressable accessibilityRole="button" disabled={busy||remaining>0||!email.trim()||save.isSuccess||(verifyEmail&&!password)} onPress={()=>request.mutate()}><Text style={styles.textLink}>{request.isPending?'发送中…':remaining>0?remaining+' 秒后重试':'获取邮箱验证码'}</Text></Pressable>
    {delivery&&!save.isSuccess?<Text style={styles.notice}>{delivery}</Text>:null}
    {request.isError||save.isError?<Text style={styles.error}>{authError(request.error??save.error)}</Text>:null}
    {save.isSuccess?<><Text style={styles.success}>{verifyEmail?'邮箱已验证，今后可用验证码登录原账号。':'密码已设置，邮箱验证码和密码均可登录当前账号。'}</Text><Pressable accessibilityRole="button" style={styles.submit} onPress={()=>router.replace('/security-center' as never)}><Text style={styles.submitText}>返回账号与验证</Text></Pressable></>:<Pressable accessibilityRole="button" style={[styles.submit,(!valid||busy)&&styles.submitDisabled]} disabled={!valid||busy} onPress={()=>save.mutate()}><Text style={styles.submitText}>{save.isPending?'保存中…':verifyEmail?'验证邮箱':'设置密码'}</Text></Pressable>}
  </AuthPage>;
}
