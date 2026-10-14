import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/api';
import { authError } from '../src/auth-error';
import { useAuthStore } from '../src/auth-store';
import type { SecurityMethods } from '../src/auth-methods';
import { colors, radius, spacing, typography } from '../src/design';
import { RuntimeDetailScreen, RuntimeSection } from '../src/runtime-details-ui';
import { passkeyAvailable } from '../src/passkey-browser';

export default function SecurityCenterPage() {
  const token=useAuthStore(s=>s.token);
  const methods=useQuery({queryKey:['security-methods',token],queryFn:()=>api<SecurityMethods>('/auth/security/methods',token),enabled:Boolean(token)});
  useFocusEffect(useCallback(()=>{if(token)void methods.refetch();},[token,methods.refetch]));
  const data=methods.data;
  const sections=data?[
    ...data.identifiers.map((item,index)=>({key:'identity-'+index,title:(item.kind==='email'?'邮箱':'手机号')+' · '+item.masked,detail:item.verified?(item.recoveryEnabled?'可用验证码登录，也可恢复当前账号密码':'可用验证码登录当前账号'):'请先验证邮箱，再使用验证码登录',icon:'person-circle-outline' as const,status:item.verified?'已验证':'待验证',route:!item.verified&&data.canVerifyEmail?'/security-credential?purpose=verify-email':undefined})),
    {key:'password',title:'登录密码',detail:data.passwordConfigured?(data.passwordLoginKinds?.includes('phone')?'当前账号的登录方式共用此密码':'已设置，可作为备用登录方式'):data.canSetPassword?'可选设置，也可继续使用验证码':'请先验证邮箱后设置密码',icon:'key-outline' as const,status:data.passwordConfigured?'已设置':'未设置',route:data.passwordConfigured?'/change-password':data.canSetPassword?'/security-credential?purpose=set-password':undefined},
    ...(data.emailBinding?.available?[{key:'bind-email',title:'添加登录邮箱',detail:'先验证当前账号，再验证新邮箱。新邮箱将登录此账号。',icon:'mail-outline' as const,status:'添加',route:'/security-bind-email'}]:[]),
    ...(data.phoneBinding?.available?[{key:'bind-phone',title:'添加登录手机号',detail:'先验证当前账号，再验证新手机号。手机号将登录此账号。',icon:'call-outline' as const,status:'添加',route:'/security-bind-phone'}]:[]),
    ...(data.phoneChange?.available?[{key:'change-phone',title:'更换登录手机号',detail:'验证当前账号与新号码。原号码停用，所有设备重新登录。',icon:'swap-horizontal-outline' as const,status:'更换',route:'/security-change-phone'}]:[]),
    ...(passkeyAvailable(data.passkeys)?[{key:'passkeys',title:'通行密钥',detail:'通过设备屏幕锁、指纹或面容验证登录当前账号。',icon:'finger-print-outline' as const,status:data.passkeys?.credentials.length?'已添加':'添加',route:'/security-passkeys'}]:[]),
  ]:[];
  return <RuntimeDetailScreen title="账号与验证" subtitle="不同登录方式进入同一账号。登录会话和可信设备在“登录与设备”中管理。" onBack={()=>router.back()}>
    <RuntimeSection title="登录与验证">
      {methods.isPending?<Text style={styles.detail}>正在读取验证状态…</Text>:null}
      {methods.isError?<Pressable accessibilityRole="button" onPress={()=>void methods.refetch()}><Text style={styles.detail}>{authError(methods.error)} · 点击重试</Text></Pressable>:null}
      <View style={styles.list}>{sections.map(section=><Pressable accessibilityRole={section.route?'button':undefined} disabled={!section.route} key={section.key} onPress={()=>section.route&&router.push(section.route as never)} style={styles.row}>
        <View style={styles.icon}><Ionicons name={section.icon} size={21} color={colors.primary}/></View><View style={styles.copy}><Text style={styles.title}>{section.title}</Text><Text style={styles.detail}>{section.detail}</Text></View><Text style={styles.status}>{section.status}</Text>{section.route?<Ionicons name="chevron-forward" size={19} color={colors.textMuted}/>:null}
      </Pressable>)}</View>
      <Text style={[styles.detail,{marginTop:spacing.md}]}>{passkeyAvailable(data?.passkeys)?'通行密钥只验证身份，敏感操作仍需单独授权。':'通行密钥在支持的网页环境逐步开放，原生 App 后续接入。敏感操作仍需单独授权。'}</Text>
      {data?.securityNotices?.length ? <View style={{marginTop:spacing.md}}><Text style={styles.title}>换号安全通知</Text>{data.securityNotices.map((notice,index)=><Text key={index} style={styles.detail}>{notice.channel==='phone'?'原手机号':'邮箱'} · {notice.masked} · {notice.state==='ACCEPTED'?'网关已受理，送达待确认':notice.state==='UNKNOWN'?'发送结果未确认':notice.state==='BLOCKED'?'发送受阻':notice.state==='CLAIMED'?'正在请求发送':'等待发送'}</Text>)}</View> : null}
    </RuntimeSection>
  </RuntimeDetailScreen>;
}
const styles=StyleSheet.create({
  list:{overflow:'hidden',borderRadius:radius.md,borderWidth:1,borderColor:colors.border,backgroundColor:colors.background},
  row:{minHeight:76,flexDirection:'row',alignItems:'center',gap:spacing.md,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.border,padding:spacing.md},
  icon:{width:38,height:38,borderRadius:radius.md,backgroundColor:colors.accentSoft,alignItems:'center',justifyContent:'center'},copy:{flex:1},
  title:{...typography.bodyStrong,color:colors.text},detail:{...typography.caption,color:colors.textSecondary,marginTop:3,lineHeight:19},status:{...typography.caption,color:colors.primary,fontWeight:'700'},
});
