import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { SegmentedControl, EmptyState, ErrorState, LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../src/consumer-presentation';
export default function MyOfferings(){
 const token=useAuthStore(s=>s.token);const [status,setStatus]=useState('PUBLISHED');
 const query=useQuery({queryKey:['my-service-offerings',token],enabled:Boolean(token),queryFn:()=>api<{id:string;title:string;summary:string;status:string;useCount:number}[]>('/my-service-offerings',token)});
 const rows=query.data?.filter(row=>row.status===status)??[];
 return <EditorPage title="我的发布"><Button label="发布服务" onPress={()=>router.push('/publish-service' as never)}/><SegmentedControl value={status} options={[{value:'PUBLISHED',label:'已发布'},{value:'DRAFT',label:'草稿'},{value:'UNPUBLISHED',label:'已下架'}]} onChange={setStatus}/>{!token?<Button label="登录" onPress={()=>router.push('/auth/login' as never)}/>:query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:rows.length?rows.map(row=><Card key={row.id} title={p.text(row.title,'服务')}><Text style={ui.detail}>{p.text(row.summary)}</Text><Text style={ui.detail}>{row.useCount} 次已完成服务</Text><Button secondary label="管理服务" onPress={()=>router.push(`/manage-service-offering?id=${row.id}` as never)}/></Card>):<EmptyState title="暂无此状态的服务"/>}</EditorPage>;
}
