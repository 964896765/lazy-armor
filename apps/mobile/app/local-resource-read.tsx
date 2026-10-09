import {useMutation,useQueryClient} from '@tanstack/react-query';
import {router,useLocalSearchParams} from 'expo-router';
import {NativeModules,PermissionsAndroid,Pressable,Switch,Text,View} from 'react-native';
import {useState} from 'react';
import {useResourceWorkspace} from '../src/resource-workspace-query';
import {currentLocalCapabilities,persistentGrantToggle,localStatus,resourceStatus} from '../src/resource-workspace';
import {syncLocalCapabilities} from '../src/local-capability-client';
import {deviceBoundApi} from '../src/trusted-device-api';
import {useAuthStore} from '../src/auth-store';
import {Button,EditorPage,ui} from '../src/editor-ui';
import {ErrorState,LoadingState} from '../src/consumer-ui';
import {ConsumerPresentationMapper as presentation} from '../src/consumer-presentation';
const permissions:Record<string,typeof PermissionsAndroid.PERMISSIONS.READ_CALENDAR>={'calendar.read':PermissionsAndroid.PERMISSIONS.READ_CALENDAR,'contacts.read':PermissionsAndroid.PERMISSIONS.READ_CONTACTS,'location.read':PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,'voice.input':PermissionsAndroid.PERMISSIONS.RECORD_AUDIO};
export default function LocalCapabilityDetail(){
 const {id}=useLocalSearchParams<{id:string}>(),token=useAuthStore(s=>s.token),query=useResourceWorkspace(),client=useQueryClient();
 const row=query.data&&currentLocalCapabilities(query.data.rows,query.data.current.id).find(r=>r.resourceId===id),state=row?.capabilityState;
 const [receipt,setReceipt]=useState<string>();
 const grant=useMutation({mutationFn:async(value:boolean)=>{if(!state||!query.data||!token)throw new Error('请先登录');await NativeModules.LazyArmorDeviceBridge.setLocalCapabilityGrant(query.data.account,state.key,value);try{await syncLocalCapabilities(token);}catch(e){if(value)await NativeModules.LazyArmorDeviceBridge.setLocalCapabilityGrant(query.data.account,state.key,false);throw e;}},onSuccess:async()=>{await query.refetch();await client.invalidateQueries({queryKey:['draft-gaps']});}});
 const permission=useMutation({mutationFn:async()=>{if(!state||!token)return;if(['calendar.create','calendar.update','calendar.delete'].includes(state.key))await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.READ_CALENDAR,PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR]);else if(permissions[state.key])await PermissionsAndroid.request(permissions[state.key]);if(state.key==='notification.read')await NativeModules.LazyArmorDeviceBridge.openNotificationAccessSettings();if(state.key==='appusage.read')await NativeModules.LazyArmorDeviceBridge.openUsageAccessSettings();await syncLocalCapabilities(token);},onSuccess:()=>query.refetch()});
 const read=useMutation({mutationFn:async()=>{if(!state||!query.data||!token)throw new Error('请先登录');await syncLocalCapabilities(token);const end=Date.now()+86400000;const body=await NativeModules.LazyArmorDeviceBridge.acquireLocalResource(query.data.account,state.key,end-2*86400000,end);return deviceBoundApi<{reason:string;itemCount:number|null}>('/consumer/local-acquisition',token,{method:'POST',body});},onSuccess:async result=>{setReceipt(`${result.reason}${result.itemCount!==null?` · ${result.itemCount} 项`:''}`);await query.refetch();}});
 const clipboard=useMutation({mutationFn:async()=>{if(!query.data||!token)throw new Error('请先登录');await NativeModules.LazyArmorDeviceBridge.setLocalCapabilityGrant(query.data.account,'clipboard.read_on_demand',true);try{return await NativeModules.LazyArmorDeviceBridge.readClipboardOnDemand();}finally{await NativeModules.LazyArmorDeviceBridge.setLocalCapabilityGrant(query.data.account,'clipboard.read_on_demand',false);await syncLocalCapabilities(token);}},onSuccess:text=>setReceipt(text?'已按次读取剪贴板内容；来源解析与保存请使用外部引用入口。':'剪贴板为空')});
 return <EditorPage title={row?.name??'本机能力'}>{query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:!row||!state?<Text style={ui.detail}>未找到当前设备能力，请返回刷新。</Text>:<>
 <Text style={ui.title}>{localStatus(row)}</Text><Text style={ui.detail}>系统权限：{resourceStatus(state.systemPermission)}</Text><Text style={ui.detail}>Lazy Armor 用户授权：{state.userGrant?'已授权':'需要授权'}</Text>
 {persistentGrantToggle(state.key,state.systemPermission)?<View style={ui.row}><Text style={[ui.label,{flex:1}]}>允许懒人装甲使用此能力</Text><Switch accessibilityLabel="Lazy Armor 用户授权" value={state.userGrant} disabled={!state.implemented||grant.isPending} onValueChange={value=>grant.mutate(value)}/></View>:<Text style={ui.detail}>按次授权；每次选择或读取时确认，不保留长期读取开关。</Text>}
 {state.implemented&&(permissions[state.key]||['calendar.create','calendar.update','calendar.delete','notification.read','appusage.read'].includes(state.key))?<Button secondary label="管理 Android 系统权限" disabled={permission.isPending} onPress={()=>permission.mutate()}/>:null}
 {state.implemented&&state.userGrant&&state.readable?<Button secondary label={read.isPending?'读取中…':'读取当前数据'} disabled={read.isPending||state.availability!=='AVAILABLE'} onPress={()=>read.mutate()}/>:null}
 {state.key==='clipboard.read_on_demand'?<Button secondary label="按次读取剪贴板" disabled={clipboard.isPending} onPress={()=>clipboard.mutate()}/>:null}
 {state.key==='files.read'?<Button secondary label="在会话中选择文件" onPress={()=>router.push('/chat' as never)}/>:null}
 {state.key==='share.read'?<Text style={ui.detail}>在其它应用的 Android 系统分享面板中选择懒人装甲，确认本次内容后获取。</Text>:null}
 <Text style={[ui.label,{marginTop:16}]}>运行与证据</Text><Text style={ui.detail}>健康：{resourceStatus(state.health??row.health)}</Text><Text style={ui.detail}>最近检查：{row.lastVerifiedAt??'暂无'}</Text><Text style={ui.detail}>最近证据：{row.evidenceRefs?.join(' · ')||'暂无'}</Text>
 <Text style={[ui.label,{marginTop:16}]}>关联计划</Text>{state.associatedPlans?.length?state.associatedPlans.map(plan=><Pressable key={plan.planId} style={ui.row} onPress={()=>router.push(`/plans/${plan.planId}` as never)}><Text style={ui.label}>{plan.title} ›</Text></Pressable>):<Text style={ui.detail}>暂无已确认绑定的计划</Text>}
 {receipt?<Text style={ui.detail}>{presentation.text(receipt)}</Text>:null}{grant.isError||permission.isError||read.isError||clipboard.isError?<Text style={ui.error}>{presentation.error(grant.error??permission.error??read.error??clipboard.error)}</Text>:null}
 </>}</EditorPage>;
}
