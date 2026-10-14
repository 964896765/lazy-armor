import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../src/api';
import { authError, authRetryLabel } from '../src/auth-error';
import type { SecurityMethods } from '../src/auth-methods';
import { useAuthStore } from '../src/auth-store';
import { passkeyAvailable, passkeyError, registerWithPasskey } from '../src/passkey-browser';
import { SegmentedControl } from '../src/consumer-ui';
import { AuthPage, styles } from './auth/login';

export default function SecurityPasskeysPage(){
  const token=useAuthStore(s=>s.token);
  const methods=useQuery({queryKey:['security-methods',token],queryFn:()=>api<SecurityMethods>('/auth/security/methods',token),enabled:Boolean(token)});
  const capability=methods.data?.passkeys;
  const [label,setLabel]=useState('我的通行密钥'),[password,setPassword]=useState(''),[code,setCode]=useState(''),[preference,setPreference]=useState('password'),[sourceId,setSource]=useState('');
  const [challenge,setChallenge]=useState(''),[target,setTarget]=useState(''),[stage,setStage]=useState<'start'|'current'|'ready'>('start');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [retryAt,setRetryAt]=useState(0),[now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const generation=useRef(0);
  const reset=()=>{setChallenge('');setPassword('');setCode('');setStage('start');setTarget('');};
  useEffect(()=>{generation.current++;reset();setBusy(false);return()=>{generation.current++;};},[token]);
  useFocusEffect(useCallback(()=>{if(token)void methods.refetch();return()=>{generation.current++;reset();setBusy(false);};},[token,methods.refetch]));
  const proof=methods.data?.passwordConfigured?preference:'code';
  const remaining=proof==='code'?Math.max(0,Math.ceil((retryAt-now)/1000)):0;
  const post=<T,>(path:string,body:unknown)=>api<T>('/auth/passkeys/'+path,token,{method:'POST',body:JSON.stringify(body)});
  const perform=async(work:(current:()=>boolean)=>Promise<void>)=>{
    const captured=generation.current,current=()=>captured===generation.current&&useAuthStore.getState().token===token;
    setBusy(true);setError('');setNotice('');
    try{await work(current);}catch(e){if(current()){if(e instanceof ApiError&&e.retryAfterMs)setRetryAt(Date.now()+e.retryAfterMs);setError(passkeyError(e)??authError(e));reset();}}finally{if(current())setBusy(false);}
  };
  const start=(credentialId?:string)=>perform(async current=>{
    const result=await post<{challenge:string;stage:'current'|'ready';delivery?:string}>('start',{operation:credentialId?'revoke':'register',...(credentialId?{credentialId}:{label}),proof,...(proof==='password'?{password}:{identifierId:sourceId||capability?.sources[0]?.id})});
    if(!current())return;setPassword('');setCode('');setChallenge(result.challenge);setTarget(credentialId??'');setStage(result.stage);
    setNotice(result.stage==='current'?(result.delivery==='LOCAL_DEVELOPMENT'?'开发验证码已生成，请查看本地后端控制台。':'请查收当前账号的验证码。'):'当前账号已验证，请在 5 分钟内完成设备验证或确认移除。');
  });
  const confirm=()=>perform(async current=>{await post('current/confirm',{challenge,code});if(current()){setCode('');setStage('ready');setNotice('当前账号已验证，请继续。');}});
  const finish=()=>perform(async current=>{
    if(target){await post('revoke/confirm',{challenge});if(!current())return;await useAuthStore.getState().clear();router.replace('/auth/login?reason=passkey-revoked' as never);}
    else{await registerWithPasskey(token!,challenge,current);if(!current())return;reset();await methods.refetch();if(current())setNotice('通行密钥已添加，仍然登录原来的账号。');}
  });
  const available=passkeyAvailable(capability);
  return <AuthPage title="通行密钥" subtitle="设备完成屏幕锁、指纹或面容验证，懒人装甲只保存公钥。" backHref="/security-center">
    {methods.isError?<Text style={styles.error}>{authError(methods.error)}</Text>:null}
    {!available?<Text style={styles.notice}>{methods.isPending?'正在读取通行密钥状态…':'当前环境暂不支持通行密钥，请使用已绑定的验证码或密码。'}</Text>:<>
      {capability?.credentials.map(item=><View key={item.id} style={styles.infoBlock}><Text style={styles.infoTitle}>{item.label}</Text><Text style={styles.infoCopy}>{item.lastUsedAt?'最近使用 '+new Date(item.lastUsedAt).toLocaleDateString():'尚未使用'}{item.backedUp?' · 设备报告已备份':''}</Text><Pressable accessibilityRole="button" disabled={busy||stage!=='start'||remaining>0} onPress={()=>void start(item.id)}><Text style={styles.textLink}>移除 {item.label}</Text></Pressable></View>)}
      {stage==='start'?<>
        <TextInput accessibilityLabel="通行密钥名称" editable={!busy} maxLength={60} placeholder="通行密钥名称" style={styles.input} value={label} onChangeText={setLabel}/>
        {methods.data?.passwordConfigured&&capability?.sources.length?<SegmentedControl value={proof} options={[{value:'password',label:'当前密码'},{value:'code',label:'已有渠道验证码'}]} onChange={value=>{if(!busy){setPreference(value);setPassword('');}}}/>:null}
        {proof==='password'?<TextInput editable={!busy} secureTextEntry placeholder="当前账号密码" accessibilityLabel="当前账号密码" style={styles.input} value={password} onChangeText={setPassword}/>:<>
          <Text style={styles.notice}>验证已有的邮箱或手机号，通行密钥将绑定此账号。</Text>
          {capability?.sources.length?<SegmentedControl value={sourceId||capability.sources[0].id} options={capability.sources.map(item=>({value:item.id,label:item.masked}))} onChange={setSource}/>:<Text style={styles.notice}>请先添加可验证的登录方式。</Text>}
        </>}
        <Pressable accessibilityRole="button" disabled={busy||remaining>0||!label.trim()||(proof==='password'?!password:!capability?.sources.length)} style={styles.submit} onPress={()=>void start()}><Text style={styles.submitText}>{busy?'验证中…':remaining>0?authRetryLabel(remaining):'验证账号并添加通行密钥'}</Text></Pressable>
      </>:null}
      {stage==='current'?<><TextInput editable={!busy} accessibilityLabel="当前账号验证码" placeholder="6 位验证码" style={styles.input} keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode}/><Pressable accessibilityRole="button" disabled={busy||!/^\d{6}$/.test(code)} style={styles.submit} onPress={()=>void confirm()}><Text style={styles.submitText}>验证当前账号</Text></Pressable></>:null}
      {stage==='ready'?<><Text style={styles.notice}>{target?'移除后所有设备退出登录，请保留其他登录方式。':'请在设备提示中保存通行密钥。设备验证不会授权付款或删除数据。'}</Text><Pressable accessibilityRole="button" disabled={busy} style={styles.submit} onPress={()=>void finish()}><Text style={styles.submitText}>{busy?'等待完成…':target?'确认移除并退出所有设备':'在设备上创建通行密钥'}</Text></Pressable></>:null}
      {stage!=='start'?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{reset();setNotice('');}}><Text style={styles.textLink}>取消</Text></Pressable>:null}
    </>}
    {notice?<Text style={styles.success}>{notice}</Text>:null}{error?<Text style={styles.error}>{error}</Text>:null}
    <Text style={styles.notice}>请保留可用的邮箱或手机号。丢失设备后，可通过已有方式登录并移除旧密钥。</Text>
  </AuthPage>;
}
