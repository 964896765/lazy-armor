import { useQuery } from '@tanstack/react-query';
import { Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { ErrorState, LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../src/consumer-presentation';
export default function ServiceSettings(){
 const token=useAuthStore(s=>s.token);
 const query=useQuery({queryKey:['service-provider-settings',token],enabled:Boolean(token),queryFn:async()=>({profile:await api<{exists:boolean;displayName?:string}>('/service-provider-profile',token),offerings:await api<{id:string;title:string;serviceArea:string|null;contact:string|null}[]>('/my-service-offerings',token)})});
 return <EditorPage title="服务设置">{query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:query.data?<>
  <Card title="服务方资料">{query.data.profile.exists?<Text style={ui.label}>{p.text(query.data.profile.displayName,'服务提供方')}</Text>:<><Text style={ui.label}>成为服务提供方</Text><Text style={ui.detail}>完善服务范围和联系方式后即可发布服务。</Text><Button label="完善并发布服务" onPress={()=>router.push('/publish-service' as never)}/></>}</Card>
  <Card title="服务地区与联系方式"><Text style={ui.detail}>每项服务使用各自的真实服务范围和联系方式。</Text>{query.data.offerings.map(item=><Pressable key={item.id} style={ui.listRow} onPress={()=>router.push(`/manage-service-offering?id=${item.id}` as never)}><Text style={ui.label}>{p.text(item.title)}</Text><Text style={ui.detail}>{p.text(item.serviceArea??'尚未填写服务地区')}</Text><Text style={ui.detail}>{p.text(item.contact??'尚未填写联系方式')} ›</Text></Pressable>)}</Card>
 </>:null}<Button secondary label="服务通知" onPress={()=>router.push('/settings' as never)}/><Text style={ui.detail}>服务进度提醒使用当前应用的消息通知权限。</Text></EditorPage>;
}
