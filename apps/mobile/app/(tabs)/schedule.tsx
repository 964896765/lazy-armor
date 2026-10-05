import { HeaderIconButton } from '../../src/header-icon-button';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TimelineItem } from '@lazy-armor/plan-schema';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { Button, ui } from '../../src/editor-ui';
import { CalendarSheet } from '../../src/calendar-sheet';
import { SegmentedControl, StatusBadge, EmptyState, LoadingState, ErrorState } from '../../src/consumer-ui';
import { ConsumerPresentationMapper as p } from '../../src/consumer-presentation';
export default function Schedule(){
 const token=useAuthStore(s=>s.token);const [date,setDate]=useState(()=>p.localDate());const [calendar,setCalendar]=useState(false);const [group,setGroup]=useState('INCOMPLETE');
 const query=useQuery({queryKey:['timeline',token,date],queryFn:()=>api<TimelineItem[]>(`/timeline?date=${date}&timezone=${encodeURIComponent(p.timeZone())}`,token),enabled:Boolean(token),refetchInterval:15000});
 const items=(query.data??[]).filter(item=>item.statusGroup===group);
 const changeDate=(value:string)=>{LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setDate(value);};
 const shift=(days:number)=>{const value=new Date(`${date}T12:00:00`);value.setDate(value.getDate()+days);changeDate(p.localDate(value));};
 return <SafeAreaView edges={['top']} style={{flex:1}}><ScrollView contentContainerStyle={ui.content}>
 <View style={ui.line}><HeaderIconButton label="我的" icon="person-outline" onPress={()=>router.push('/profile' as never)}/><View style={{flex:1,minWidth:0}}><SegmentedControl value={group} onChange={setGroup} options={[{value:'INCOMPLETE',label:'未完成',count:query.data?.filter(item=>item.statusGroup==='INCOMPLETE').length},{value:'COMPLETED',label:'已完成',count:query.data?.filter(item=>item.statusGroup==='COMPLETED').length}]}/></View><HeaderIconButton label="设置" icon="settings-outline" onPress={()=>router.push('/settings' as never)}/></View>
 <View style={[ui.line,{justifyContent:'space-between'}]}>{['前一天','日期','后一天'].map((label,index)=><Pressable key={label} accessibilityLabel={index===1?'打开日历':label} onPress={()=>index===1?setCalendar(true):shift(index===0?-1:1)} style={({pressed})=>[ui.pill,{minHeight:44,justifyContent:'center',backgroundColor:pressed?'#DCE9F8':index===1?'rgba(255,255,255,0.38)':'rgba(255,255,255,0.18)'}]}><Text style={ui.label}>{index===1?`${new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',weekday:'short'})} ▦`:index===0?'‹ 前一天':'后一天 ›'}</Text>{index===1&&date===p.localDate()?<Text style={{fontSize:10,color:'#2589FF',textAlign:'center'}}>今天</Text>:null}</Pressable>)}</View>
 <View style={[ui.line,{justifyContent:'space-between'}]}><Text style={ui.title}>共 {items.length} 项</Text><Text style={ui.detail}>按时间排序</Text></View>
 {!token?<Button label="登录后查看日程" onPress={()=>router.push('/auth/login' as never)}/>:query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:items.map(item=><Pressable key={item.id} onPress={()=>router.push(item.primaryAction.path as never)} style={({pressed})=>[ui.listRow,ui.line,pressed&&{backgroundColor:'rgba(225,236,249,0.38)'}]}><Text style={[ui.label,{width:48}]}>{item.allDay?'全天':p.time(item.scheduledAt??item.occurredAt)}</Text><View style={{width:1,height:32,backgroundColor:'#CADCF1'}}/><View style={{flex:1,minWidth:0,gap:5}}><Text numberOfLines={2} style={ui.title}>{p.text(item.title,'日程事项')}</Text><Text numberOfLines={2} style={ui.detail}>{p.text(item.subtitle,'查看本次事项')}</Text><StatusBadge label={p.text(item.status,'待处理')}/></View><Ionicons name="chevron-forward" size={20} color="#667085"/></Pressable>)}
 {token&&!query.isLoading&&!query.isError&&!items.length?<EmptyState title={group==='COMPLETED'?'这一天还没有完成事项':'这一天没有待处理事项'} detail="计划运行、会话结果与服务请求会统一显示在这里。"/>:null}
 </ScrollView><CalendarSheet visible={calendar} date={date} onSelect={changeDate} onClose={()=>setCalendar(false)}/></SafeAreaView>;
}
