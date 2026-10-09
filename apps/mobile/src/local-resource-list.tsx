import {Pressable,Text,View} from 'react-native';
import {router} from 'expo-router';
import type {ResourceProjection,RuntimeTarget} from '@lazy-armor/plan-schema';
import {ui} from './editor-ui';
import {currentLocalCapabilities,localStatus,localCapabilitySection} from './resource-workspace';
export function LocalResourceList({rows,currentId,target,deviceName,appCount}:{rows:ResourceProjection[];currentId:string;target?:RuntimeTarget;deviceName:string;appCount:number|null}){
 const local=currentLocalCapabilities(rows,currentId);
 return <View><View style={ui.listRow}><Text style={ui.title}>{deviceName}</Text><Text style={ui.detail}>{target?.onlineState==='ONLINE'?'在线':target?.onlineState==='OFFLINE'?'设备离线':'在线状态待检查'} · {local.filter(r=>r.capabilityState?.availability==='AVAILABLE').length}/{local.length} 项能力可用</Text><Text style={ui.detail}>最近检查：{target?.lastSeenAt?new Date(target.lastSeenAt).toLocaleString():'暂无在线证据'}</Text></View>
 {['信息获取','设备执行','应用能力'].map(group=><View key={group}><Text style={[ui.label,{marginTop:16}]}>{group}</Text>{local.filter(r=>localCapabilitySection(r.capabilityState!.key)===group).map(row=><Pressable key={row.resourceId} accessibilityRole="button" style={ui.row} onPress={()=>router.push({pathname:'/local-resource-read',params:{id:row.resourceId}} as never)}><Text style={[ui.label,{flex:1}]}>{row.name}</Text><Text style={ui.detail}>{localStatus(row)} ›</Text></Pressable>)}
 {group==='应用能力'?<Pressable accessibilityRole="button" style={ui.row} onPress={()=>router.push('/phone-apps' as never)}><Text style={[ui.label,{flex:1}]}>手机应用</Text><Text style={ui.detail}>{appCount===null?'待检查':`已发现 ${appCount} 个应用`} ›</Text></Pressable>:null}</View>)}

 {!local.length?<Text style={ui.detail}>暂无当前设备能力，请刷新检查。</Text>:null}</View>;
}
