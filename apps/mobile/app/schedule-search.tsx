import {useQuery} from '@tanstack/react-query';
import {router} from 'expo-router';
import {useState} from 'react';
import {Pressable,Text,TextInput} from 'react-native';
import type {TimelineItem} from '@lazy-armor/plan-schema';
import {api} from '../src/api';
import {useAuthStore} from '../src/auth-store';
import {EditorPage,ui} from '../src/editor-ui';
import {ErrorState,LoadingState,SegmentedControl,EmptyState} from '../src/consumer-ui';
import {scheduleRows,type ScheduleMessage} from '../src/schedule-projection';
import type {TodoItem} from '../src/todo-presenter';
export default function ScheduleSearch(){const token=useAuthStore(s=>s.token),[text,setText]=useState(''),[filter,setFilter]=useState('ALL');const query=useQuery({queryKey:['schedule-search',token],enabled:Boolean(token),queryFn:async()=>{const [timeline,attention,messages]=await Promise.all([api<TimelineItem[]>('/timeline?date=all&timezone=Asia%2FShanghai',token),api<TodoItem[]>('/attention',token),api<ScheduleMessage[]>('/notifications',token)]);return scheduleRows(timeline,attention,messages);}});const rows=(query.data??[]).filter(r=>(filter==='ALL'||r.statusGroup===filter||r.section===filter)&&`${r.title} ${r.subtitle} ${r.status}`.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase()));return <EditorPage title="搜索日程"><TextInput accessibilityLabel="搜索全量记录" placeholder="搜索计划、执行、服务与动态" value={text} onChangeText={setText} style={ui.input}/><SegmentedControl value={filter} onChange={setFilter} options={[{value:'ALL',label:'全部'},{value:'INCOMPLETE',label:'未完成'},{value:'COMPLETED',label:'已完成'},{value:'需要你处理',label:'需处理'}]}/>{query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:rows.length?rows.map(r=><Pressable key={r.id} style={ui.listRow} onPress={()=>router.push(r.primaryAction.path as never)}><Text style={ui.title}>{r.title}</Text><Text style={ui.detail}>{r.status} · {new Date(r.occurredAt).toLocaleString('zh-CN')}</Text><Text numberOfLines={2} style={ui.detail}>{r.subtitle}</Text></Pressable>):<EmptyState title="没有匹配的记录" detail="调整搜索词或筛选条件。"/>}</EditorPage>;}
