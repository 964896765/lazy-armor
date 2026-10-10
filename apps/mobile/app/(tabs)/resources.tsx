import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {router,useLocalSearchParams} from 'expo-router';
import {Pressable,ScrollView,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {HeaderIconButton} from '../../src/header-icon-button';
import {SegmentedControl,ErrorState,LoadingState} from '../../src/consumer-ui';
import {Button,ui} from '../../src/editor-ui';
import {useAuthStore} from '../../src/auth-store';
import {useRuntimeSettings} from '../../src/runtime-settings';
import {useResourceWorkspace} from '../../src/resource-workspace-query';
import {resourceTabs,contextualAdd,targetLabel,targetPartition,resourceStatus,workspaceState,type ResourceTab} from '../../src/resource-workspace';
import {LocalResourceList} from '../../src/local-resource-list';
import {discoverLaunchableApps} from '../../src/device-app-bridge';
export default function Resources(){
 const params=useLocalSearchParams<{tab?:ResourceTab;returnConversationId?:string;returnMode?:string}>();
 const [kind,setKind]=useState<ResourceTab>(resourceTabs.some(t=>t.value===params.tab)?params.tab!:'LOCAL');
 const token=useAuthStore(s=>s.token),name=useRuntimeSettings(s=>s.deviceName);
 const query=useResourceWorkspace();
 const apps=useQuery({queryKey:['resource-app-discovery',token],queryFn:discoverLaunchableApps,enabled:Boolean(token)&&kind==='LOCAL'});
 const data=query.data,partition=data?targetPartition(data.targets,data.current.id,data.current.deviceId):undefined;
 const rows=(data?.rows??[]).filter(r=>r.kind===kind&&(kind!=='DEVICE'||r.sourceRef.type==='TrustedDevice'));
 const viewState=workspaceState(query.isLoading,query.isError,rows.length);
 return <SafeAreaView edges={['top']} style={{flex:1}}><ScrollView contentContainerStyle={ui.content}>
 <View style={ui.line}><Text style={[ui.pageTitle,{textAlign:'left'}]}>资源</Text><HeaderIconButton label={contextualAdd[kind].label} icon="add" onPress={()=>router.push(contextualAdd[kind].path as never)}/></View>
 <SegmentedControl value={kind} options={[...resourceTabs]} onChange={value=>setKind(value as ResourceTab)}/>
 {token?<Pressable accessibilityRole="button" style={ui.row} onPress={()=>router.push('/personal-memory' as never)}><Text style={[ui.label,{flex:1}]}>个人记忆</Text><Text style={ui.detail}>资料、设备、偏好与历史 ›</Text></Pressable>:null}
 {token&&kind==='INTERFACE'?<Pressable accessibilityRole="button" style={ui.row} onPress={()=>router.push('/browser-resource' as never)}><Text style={[ui.label,{flex:1}]}>受控网页</Text><Text style={ui.detail}>查看可用状态与网站范围 ›</Text></Pressable>:null}
 {params.returnConversationId?<Button secondary label="返回计划会话" onPress={()=>router.replace({pathname:'/chat',params:{mode:params.returnMode??'plan',conversationId:params.returnConversationId}} as never)}/>:null}
 {!token?<Button label="登录后管理资源" onPress={()=>router.push('/auth/login' as never)}/>:viewState==='loading'?<LoadingState/>:viewState==='error'?<ErrorState onRetry={()=>void query.refetch()}/>:kind==='LOCAL'&&data?<><LocalResourceList rows={data.rows} currentId={data.current.id} target={partition?.current} deviceName={data.deviceName} appCount={apps.isSuccess?apps.data.length:null}/>{apps.isError?<Text style={ui.detail}>应用发现暂时失败，点击应用能力后可重试。</Text>:null}</>:kind==='DEVICE'?<>
 {partition?.other.map(t=><Pressable key={t.targetId} style={ui.row} onPress={()=>router.push({pathname:'/runtime-target-detail',params:{id:t.targetId}} as never)}><Text style={[ui.label,{flex:1}]}>{targetLabel(t)}</Text><Text style={ui.detail}>{t.onlineState==='OFFLINE'?'设备离线':t.health==='UNAVAILABLE'?'异常':t.onlineState==='ONLINE'?'已连接':'待检查'} ›</Text></Pressable>)}
 {!partition?.other.length?<View style={ui.listRow}><Text style={ui.detail}>暂无其它已配对设备</Text><Button secondary label="配对设备" onPress={()=>router.push('/pair-device' as never)}/></View>:null}
 </>:<>{rows.map(r=><Pressable key={r.resourceId} style={ui.row} onPress={()=>router.push(r.primaryAction.path as never)}><View style={{flex:1}}><Text style={ui.label}>{r.name}</Text>{r.capabilitySummary?<Text style={ui.detail}>可用能力 {r.capabilitySummary.available}/{r.capabilitySummary.total} · {r.capabilitySummary.items.slice(0,2).map(c=>c.name).join("、")||"待接入"}</Text>:null}</View><Text style={ui.detail}>{resourceStatus(r.status)} ›</Text></Pressable>)}
 {kind==='INTERFACE'?['HTTP/REST','OpenAPI','MCP Server'].filter(label=>label!=='MCP Server'||!data?.targets.some(t=>t.targetType==='MCP_SERVER')).map(label=><Pressable key={label} style={ui.row} onPress={()=>router.push({pathname:'/add-interface',params:{protocol:label}} as never)}><Text style={[ui.label,{flex:1}]}>{label}</Text><Text style={ui.detail}>待接入 ›</Text></Pressable>):null}
 {kind==='INTERFACE'?data?.targets.filter(t=>t.targetType==='MCP_SERVER').map(t=><Pressable key={t.targetId} style={ui.row} onPress={()=>router.push({pathname:'/runtime-target-detail',params:{id:t.targetId}} as never)}><Text style={[ui.label,{flex:1}]}>MCP Server</Text><Text style={ui.detail}>{t.health==='HEALTHY'?'已连接':'待检查'} ›</Text></Pressable>):null}
 {!rows.length&&kind==='CLOUD'?<Text style={ui.detail}>暂无云端资源目录</Text>:null}</>}
 </ScrollView></SafeAreaView>;
}
