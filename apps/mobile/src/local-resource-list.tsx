import {syncLocalCapabilities} from './local-capability-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppState, NativeModules, PermissionsAndroid, Platform, Pressable, Switch, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import {localCapabilityGroup} from '@lazy-armor/plan-schema/local-capabilities';
import type { ResourceProjection } from '@lazy-armor/plan-schema';
import { api } from './api';
import { deviceBoundApi } from './trusted-device-api';
import { useAuthStore } from './auth-store';
import { Button, ui } from './editor-ui';
import { ConsumerPresentationMapper as presentation } from './consumer-presentation';
import { ErrorState, LoadingState } from './consumer-ui';

const permissions:Record<string,typeof PermissionsAndroid.PERMISSIONS.READ_CALENDAR>={
 'calendar.read':PermissionsAndroid.PERMISSIONS.READ_CALENDAR,'contacts.read':PermissionsAndroid.PERMISSIONS.READ_CONTACTS,'location.read':PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,'voice.input':PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
};
export function LocalResourceList(){
 const token=useAuthStore(state=>state.token);const client=useQueryClient();const [account,setAccount]=useState<string>();
 const [expanded,setExpanded]=useState<string>();
 const [receipt,setReceipt]=useState<{key:string;reason:string;itemCount:number|null}>();
 const query=useQuery({queryKey:['local-capabilities',token],enabled:Boolean(token),queryFn:async()=>{const userId=await syncLocalCapabilities(token!);setAccount(userId);return deviceBoundApi<ResourceProjection[]>('/consumer/resources',token!,{method:'GET'});}});
 useEffect(()=>{const subscription=AppState.addEventListener('change',state=>{if(state==='active')void query.refetch();});return ()=>subscription.remove();},[token]);
 const grant=useMutation({mutationFn:async({key,value}:{key:string;value:boolean})=>{
  if(!token||!account)throw new Error('请先登录并读取能力清单');
  await NativeModules.LazyArmorDeviceBridge.setLocalCapabilityGrant(account,key,value);
  try{await syncLocalCapabilities(token);}catch(error){if(value)await NativeModules.LazyArmorDeviceBridge.setLocalCapabilityGrant(account,key,false);throw error;}
 },onSuccess:async()=>{await query.refetch();await client.invalidateQueries({queryKey:['draft-gaps']});}});
 const read=useMutation({mutationFn:async(key:string)=>{
  if(!token||!account)throw new Error('请先登录');
  if(permissions[key])await PermissionsAndroid.request(permissions[key]);
  if(key==='appusage.read')await NativeModules.LazyArmorDeviceBridge.openUsageAccessSettings();
  if(key==='notification.read')await NativeModules.LazyArmorDeviceBridge.openNotificationAccessSettings();
  await syncLocalCapabilities(token);
  const end=Date.now()+86400000;const body=await NativeModules.LazyArmorDeviceBridge.acquireLocalResource(account,key,end-2*86400000,end);
  const result=await deviceBoundApi<{reason:string;itemCount:number|null}>('/consumer/local-acquisition',token,{method:'POST',body});return {...result,key};
 },onSuccess:async result=>{setReceipt(result);await query.refetch();await client.invalidateQueries({queryKey:['draft-gaps']});}});
 if(!token)return <Button label="登录后管理本机能力" onPress={()=>router.push('/auth/login' as never)}/>;
 if(query.isLoading)return <LoadingState/>;
 if(query.isError)return <ErrorState onRetry={()=>void query.refetch()}/>;
 const rows=(query.data??[]).filter(row=>row.kind==='LOCAL'&&row.capabilityState&&row.capabilityState.key!=='photos.read');
 return <View><Button secondary label="分享、粘贴与外部引用" onPress={()=>router.push('/external-references' as never)}/><Text style={ui.detail}>开关表示允许懒人装甲使用此能力；系统权限需单独授权。</Text>{['信息获取','设备执行','高级能力'].map(group=><View key={group}><Text style={[ui.label,{marginTop:16}]}>{group}</Text>{rows.filter(row=>localCapabilityGroup(row.capabilityState!.key)===group).map(row=>{
  const state=row.capabilityState!;return <View key={row.resourceId} style={[ui.listRow,{paddingVertical:10}]}>
   <View style={ui.line}><Pressable style={{flex:1}} onPress={()=>setExpanded(expanded===state.key?undefined:state.key)}><Text style={ui.label}>{row.name} ›</Text></Pressable><Text style={ui.detail}>{row.status}</Text><Switch accessibilityLabel={row.name+'授权'} value={state.userGrant} disabled={!state.implemented||grant.isPending} onValueChange={value=>grant.mutate({key:state.key,value})}/></View>
   {expanded===state.key?<View><Text style={ui.detail}>系统权限：{state.systemPermission} · 用户授权：{state.userGrant?'允许':'未允许'}</Text><Text style={ui.detail}>健康：{state.health??row.health}</Text><Text style={ui.detail}>最近检查：{row.lastVerifiedAt??'暂无'} · 证据：{row.evidenceRefs?.join(' · ')??'暂无'}</Text>{state.associatedPlans?.length?state.associatedPlans.map(plan=><Pressable key={plan.planId} onPress={()=>router.push(`/plans/${plan.planId}` as never)}><Text style={ui.detail}>关联计划：{plan.title} ›</Text></Pressable>):<Text style={ui.detail}>暂无已确认绑定的计划</Text>}</View>:null}
   {state.implemented&&state.userGrant&&state.readable?<Pressable accessibilityRole="button" disabled={read.isPending} onPress={()=>read.mutate(state.key)}><Text style={[ui.detail,{color:'#287BFF'}]}>{read.isPending&&read.variables===state.key?'读取中…':state.systemPermission==='GRANTED'?'读取当前数据':'授权并读取'}</Text></Pressable>:null}
   {state.key==='voice.input'&&state.userGrant&&state.systemPermission!=='GRANTED'?<Pressable onPress={async()=>{await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);void query.refetch();}}><Text style={[ui.detail,{color:'#287BFF'}]}>授权麦克风</Text></Pressable>:null}
   {state.key==='files.read'&&state.userGrant?<Text style={ui.detail}>在会话附件中选择文件；每份文件单独授权。</Text>:null}
   {!state.implemented?<Text style={ui.detail}>当前未开放；不表示可用</Text>:null}
   {receipt?.key===state.key?<Text style={ui.detail}>{presentation.text(receipt.reason)}{receipt.itemCount!==null?` · ${receipt.itemCount} 项`:''}</Text>:null}
  </View>;
 })}</View>)}{grant.isError||read.isError?<Text style={ui.error}>{presentation.error(grant.error??read.error)}</Text>:null}</View>;
}
