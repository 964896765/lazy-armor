import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { EditorPage, Button, ui } from '../src/editor-ui';
import { EmptyState, ErrorState, LoadingState } from '../src/consumer-ui';
export default function ArchivedConversations() {
 const token=useAuthStore(s=>s.token);
 const query=useQuery({queryKey:['archived-conversations',token],queryFn:()=>api<Array<{id:string;title:string;mode:string}>>('/conversations/archived',token),enabled:Boolean(token)});
 return <EditorPage title="已归档">{!token?<Button label="登录后查看" onPress={()=>router.push('/auth/login' as never)}/>:query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:query.data?.length?query.data.map(item=><Pressable key={item.id} accessibilityRole="button" onPress={()=>router.push({pathname:'/chat',params:{conversationId:item.id,mode:item.mode==='PLAN'?'plan':'temporary'}} as never)} style={ui.row}><View style={{flex:1,minWidth:0}}><Text numberOfLines={1} ellipsizeMode="tail" style={ui.title}>{item.title}</Text><Text style={ui.detail}>{item.mode==='PLAN'?'计划会话':'临时会话'}</Text></View><Ionicons name="chevron-forward" size={18} color="#667085"/></Pressable>):<EmptyState title="暂无归档会话" detail="归档的会话会保留在这里。"/>}</EditorPage>;
}
