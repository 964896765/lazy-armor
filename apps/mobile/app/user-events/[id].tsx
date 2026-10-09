import { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserEventView } from '@lazy-armor/plan-schema';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { Button, EditorPage, ui } from '../../src/editor-ui';
import { ConsumerPresentationMapper as p } from '../../src/consumer-presentation';
import { eventInstant, eventLocalInput } from '../../src/user-event-time';

export default function UserEventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useAuthStore(s => s.token), client = useQueryClient();
  const [editing, setEditing] = useState(false), [title, setTitle] = useState(''), [due, setDue] = useState(''), [reminder, setReminder] = useState(''), [error, setError] = useState(''), [editVersion, setEditVersion] = useState<number | null>(null);
  const query = useQuery({ queryKey: ['user-event', token, id], queryFn: () => api<UserEventView>(`/user-events/${id}`, token), enabled: Boolean(token && id), refetchInterval: 10_000 });
  const sync = useQuery({queryKey:['user-event-sync',token,id],queryFn:()=>api<Array<{requestId:string;state:string;title:string;message:string;externalEventId:string|null;changeProposal:{kind:string;version:number}|null}>>(`/user-events/${id}/external-sync`,token),enabled:Boolean(token&&id),refetchInterval:10_000});
  const event = query.data;
  useEffect(() => { if (event && !editing) { setTitle(event.title); setDue(eventLocalInput(event.dueAt, event.timezone)); setReminder(eventLocalInput(event.reminderAt, event.timezone)); } }, [event, editing]);
  const change = useMutation({ mutationFn: (action: 'EDIT' | 'POSTPONE' | 'COMPLETE' | 'CANCEL') => {
    if (!event) throw Error('请先刷新事项');
    let values;
    if (action === 'EDIT') values = { title, timezone: event.timezone, dueAt: eventInstant(due, event.timezone), reminderAt: eventInstant(reminder, event.timezone) };
    if (action === 'POSTPONE') {
      const next = new Date(Math.max(Date.now(), Date.parse(event.dueAt)) + 15 * 60_000);
      const instant = eventInstant(eventLocalInput(next.toISOString(), event.timezone), event.timezone);
      values = { title: event.title, timezone: event.timezone, dueAt: instant, reminderAt: instant };
    }
    return api<UserEventView>(`/user-events/${id}/lifecycle`, token, { method: 'POST', body: JSON.stringify({ version: action === 'EDIT' ? editVersion : event.version, action, ...(values ? { event: values } : {}) }) });
  }, onSuccess: value => { client.setQueryData(['user-event', token, id], value); setEditing(false); setError(''); void client.invalidateQueries({queryKey:['user-event-sync',token,id]}); void client.invalidateQueries({ queryKey: ['timeline'] }); void client.invalidateQueries({ queryKey: ['notifications'] }); }, onError: e => { setError(p.error(e.message)); void query.refetch(); } });
  const format = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: event?.timezone });
  const syncChange=useMutation({mutationFn:async(requestId:string)=>{
    if(!event)throw Error('请先刷新事项');
    const proposal=await api<{messageId:string;version:number;operation:string}>(`/user-events/${id}/external-sync/${requestId}/propose-change`,token,{method:'POST',body:JSON.stringify({version:event.version})});
    const accepted=await new Promise<boolean>(resolve=>Alert.alert(proposal.operation==='DELETE'?'删除手机日历中的事项？':'更新手机日历中的事项？',proposal.operation==='DELETE'?'将删除已关联的手机日历事项；内部事项保持已取消。确认此建议后，外部执行仍需独立审批。':`${event.title}\n${format(event.dueAt)}\n只更新已关联的手机日历事项；确认此建议后，外部执行仍需独立审批。`,[{text:'暂不处理',style:'cancel',onPress:()=>resolve(false)},{text:'确认同步建议',onPress:()=>resolve(true)}],{cancelable:true,onDismiss:()=>resolve(false)}));
    if(!accepted)return;
    const confirmed=await api<{requestId:string}>(`/user-events/${id}/external-sync/confirm-change`,token,{method:'POST',body:JSON.stringify({version:proposal.version,messageId:proposal.messageId,confirmed:true})});
    await api(`/user-events/${id}/external-sync/${confirmed.requestId}/start`,token,{method:'POST',body:'{}'});
  },onSuccess:()=>{setError('');void sync.refetch();},onError:e=>{setError(p.error(e.message));void sync.refetch();}});
  return <EditorPage title="个人事项">
    {query.isLoading ? <Text style={ui.detail}>正在读取事项…</Text> : query.isError ? <Button label="读取失败，重试" onPress={()=>void query.refetch()}/> : event ? <>
      <Text style={ui.title}>{event.title}</Text><Text style={ui.detail}>{event.status === 'completed' ? '已完成' : event.status === 'cancelled' ? '已取消' : event.remindedAt ? '提醒已送达' : '待提醒'}</Text>
      <Text style={ui.label}>事项时间</Text><Text style={ui.detail}>{format(event.dueAt)}</Text>
      <Text style={ui.label}>提醒时间</Text><Text style={ui.detail}>{format(event.reminderAt)}</Text>
      <Text style={ui.detail}>{event.timezone} · 懒人装甲站内提醒</Text>
      {sync.data?.map(item=><View key={item.requestId}><Text style={ui.detail}>{item.title}：{item.message}</Text>{item.changeProposal?<Button secondary label={item.changeProposal.kind==='CANCEL_EXTERNAL'?'确认删除手机日历事项':'确认更新手机日历事项'} disabled={syncChange.isPending} onPress={()=>syncChange.mutate(item.requestId)}/>:null}</View>)}
      {sync.isError?<Text style={ui.detail}>手机日历同步状态暂时无法读取，内部事项仍可管理。</Text>:null}
      {event.status === 'active' ? editing ? <>
        <Text style={ui.label}>事项名称</Text><TextInput accessibilityLabel="事项名称" style={ui.input} value={title} maxLength={160} onChangeText={setTitle}/>
        <Text style={ui.label}>事项日期与时间</Text><TextInput accessibilityLabel="事项日期与时间" autoCorrect={false} autoCapitalize="none" style={ui.input} value={due} placeholder="2026-10-08 15:00" onChangeText={setDue}/>
        <Text style={ui.label}>提醒日期与时间</Text><TextInput accessibilityLabel="提醒日期与时间" autoCorrect={false} autoCapitalize="none" style={ui.input} value={reminder} placeholder="2026-10-08 15:00" onChangeText={setReminder}/>
        <Button label="保存修改" disabled={change.isPending} onPress={()=>change.mutate('EDIT')}/><Button secondary label="取消修改" disabled={change.isPending} onPress={()=>setEditing(false)}/>
      </> : <>
        <Button label="完成事项" disabled={change.isPending} onPress={()=>change.mutate('COMPLETE')}/>
        <Button secondary label="延后 15 分钟" disabled={change.isPending} onPress={()=>change.mutate('POSTPONE')}/>
        <Button secondary label="编辑事项" disabled={change.isPending} onPress={()=>{setEditVersion(event.version);setEditing(true);}}/>
        <Button secondary label="取消事项" disabled={change.isPending} onPress={()=>Alert.alert('取消这件事？',sync.data?.length?'取消后将不再提醒。已同步或待核对的手机日历事项不会自动删除。':'取消后将不再提醒。',[{text:'保留',style:'cancel'},{text:'确认取消',style:'destructive',onPress:()=>change.mutate('CANCEL')}])}/>
      </> : null}
    </> : null}{error ? <Text style={ui.error}>{error}</Text> : null}
  </EditorPage>;
}
