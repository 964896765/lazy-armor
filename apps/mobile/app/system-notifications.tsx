import {useQuery} from '@tanstack/react-query';
import {router} from 'expo-router';
import {Pressable,Text} from 'react-native';
import {api} from '../src/api';
import {useAuthStore} from '../src/auth-store';
import {EditorPage,ui} from '../src/editor-ui';
import {messageChannel} from '../src/message-presenter';
import {notificationDeepLink} from '../src/consumer-error-presenter';
import {ErrorState,LoadingState,EmptyState} from '../src/consumer-ui';
import type {ScheduleMessage} from '../src/schedule-projection';
export default function SystemNotifications(){const token=useAuthStore(s=>s.token),query=useQuery({queryKey:['notifications',token],enabled:Boolean(token),queryFn:()=>api<ScheduleMessage[]>('/notifications',token)}),rows=(query.data??[]).filter(r=>messageChannel(r.eventType)==='system');return <EditorPage title="安全与系统通知">{query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:rows.length?rows.map(r=><Pressable key={r.id} style={ui.listRow} onPress={()=>router.push((notificationDeepLink(r)||'/security-center') as never)}><Text style={ui.title}>{r.title}</Text><Text style={ui.detail}>{r.body}</Text></Pressable>):<EmptyState title="暂无系统通知" detail="登录、安全、版本与隐私通知显示在这里。"/>}</EditorPage>;}
