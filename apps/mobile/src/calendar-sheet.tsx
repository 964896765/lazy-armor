import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConsumerPresentationMapper as p } from './consumer-presentation';
import { calendarDateInfo } from './calendar-date-info';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { ui } from './editor-ui';
interface CalendarProjection {
 dates: Array<{date:string;state:'AVAILABLE'|'UNAVAILABLE';total:number|null;incomplete:number|null;completed:number|null;workItems:number|null}>;
 holidays: {state:string;reason:string};
 weather: {state:string;reason:string;forecasts:unknown[]};
}
export function CalendarSheet({visible,date,onSelect,onClose}:{visible:boolean;date:string;onSelect:(date:string)=>void;onClose:()=>void}) {
 const [month,setMonth]=useState(()=>new Date(`${date}T12:00:00`));
 const token=useAuthStore(state=>state.token);const insets=useSafeAreaInsets();const {height}=useWindowDimensions();
 useEffect(()=>{if(visible)setMonth(new Date(`${date}T12:00:00`));},[visible,date]);
 const monthKey=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`;
 const projection=useQuery({queryKey:['calendar-projection',token,monthKey,p.timeZone()],queryFn:()=>api<CalendarProjection>(`/consumer/calendar?month=${monthKey}&timezone=${encodeURIComponent(p.timeZone())}`,token),enabled:visible&&Boolean(token),staleTime:15000});
 const first=new Date(month.getFullYear(),month.getMonth(),1);const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
 const marks=new Map(projection.data?.dates.map(item=>[item.date,item])??[]);const selectedInfo=calendarDateInfo(date);
 return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(16,24,40,0.4)'}}>
 <Pressable accessibilityLabel="关闭日期选择器" onPress={onClose} style={{flex:1}}/>
 <View style={{height:Math.min(height-insets.top-16,Math.max(560,height*0.8)),backgroundColor:'#FFFFFF',borderTopLeftRadius:22,borderTopRightRadius:22,paddingHorizontal:16,paddingTop:12,paddingBottom:Math.max(12,insets.bottom)}}>
 <View style={[ui.line,{justifyContent:'space-between'}]}><Pressable accessibilityRole="button" style={ui.back} onPress={()=>{onSelect(p.localDate());onClose();}}><Text style={{color:'#174D91',fontSize:15,fontWeight:'600'}}>今天</Text></Pressable><Text style={ui.title}>选择日期</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭日历" style={ui.back} onPress={onClose}><Text style={ui.label}>关闭</Text></Pressable></View>
 <ScrollView showsVerticalScrollIndicator={false}>
 <View style={{padding:12,gap:4,backgroundColor:'#F2F5FA',borderRadius:12,marginVertical:8}}><Text style={ui.title}>{new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</Text><Text style={ui.detail}>农历 {selectedInfo.year} {selectedInfo.lunar}{selectedInfo.term?' · '+selectedInfo.term:''}</Text>{selectedInfo.festivals.length?<Text style={{color:'#A14525',fontSize:13}}>{selectedInfo.festivals.join(' · ')}</Text>:null}</View>
 <View style={[ui.line,{justifyContent:'space-between'}]}><Pressable accessibilityRole="button" accessibilityLabel="上个月" style={ui.back} onPress={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><Text style={{fontSize:24,color:'#101828'}}>‹</Text></Pressable><Text style={{fontSize:18,fontWeight:'700',color:'#101828'}}>{month.getFullYear()}年 {month.getMonth()+1}月</Text><Pressable accessibilityRole="button" accessibilityLabel="下个月" style={ui.back} onPress={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><Text style={{fontSize:24,color:'#101828'}}>›</Text></Pressable></View>
 <View style={{flexDirection:'row',paddingVertical:8}}>{['日','一','二','三','四','五','六'].map((day,index)=><Text key={day} style={[ui.detail,{width:'14.285%',textAlign:'center',color:index===0||index===6?'#A14525':'#667085'}]}>{day}</Text>)}</View>
 <View style={{flexDirection:'row',flexWrap:'wrap'}}>{Array.from({length:Math.ceil((first.getDay()+days)/7)*7},(_,index)=>{
 const day=index-first.getDay()+1;if(day<1||day>days)return <View key={index} style={{width:'14.285%',height:64}}/>;
 const value=p.localDate(new Date(month.getFullYear(),month.getMonth(),day));const info=calendarDateInfo(value);const selected=value===date;const mark=marks.get(value);
 return <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} 农历${info.lunar} ${info.label}${mark?.state==='AVAILABLE'?' '+mark.total+'项事项':' 事项未获取'}`} accessibilityState={{selected}} onPress={()=>onSelect(value)} style={({pressed})=>({width:'14.285%',height:64,alignItems:'center',justifyContent:'center',gap:3,borderRadius:12,backgroundColor:selected?'#174D91':pressed?'#E3ECF8':'transparent',borderWidth:value===p.localDate()&&!selected?1:0,borderColor:'#8BAACA'})}>
 <Text style={{color:selected?'#FFFFFF':'#101828',fontSize:17,fontWeight:selected?'700':'500'}}>{day}</Text><Text numberOfLines={1} style={{fontSize:10,color:selected?'#E6F0FF':info.term||info.festivals.length?'#A14525':'#667085',maxWidth:'95%'}}>{info.label}</Text>
 <View style={{height:5,flexDirection:'row',gap:3}}>{mark?.incomplete?<View style={{height:4,width:4,borderRadius:2,backgroundColor:selected?'#FFFFFF':'#2589FF'}}/>:null}{mark?.completed?<View style={{height:4,width:4,borderRadius:2,backgroundColor:selected?'#BDE9D5':'#238461'}}/>:null}{mark?.state==='UNAVAILABLE'?<Text style={{fontSize:8,color:'#667085'}}>?</Text>:null}</View></Pressable>;
 })}</View>
 <View style={[ui.line,{paddingVertical:10}]}><Text style={{fontSize:12,color:'#2589FF'}}>● 待处理</Text><Text style={{fontSize:12,color:'#238461'}}>● 已完成</Text><Text style={ui.detail}>来自真实日程</Text>{projection.isFetching?<ActivityIndicator size="small"/>:null}</View>
 {projection.isError?<Pressable accessibilityRole="button" onPress={()=>void projection.refetch()} style={{paddingVertical:8}}><Text style={{color:'#A14525',fontSize:13}}>事项读取失败，点击重试</Text></Pressable>:!token?<Text style={ui.detail}>登录后显示当天事项</Text>:<Text style={ui.detail}>{marks.get(date)?.state==='AVAILABLE'?`当天 ${marks.get(date)?.total} 项事项${marks.get(date)?.workItems!==null?' · '+marks.get(date)?.workItems+' 项关联任务':''}`:'当天事项尚未获取'}</Text>}
 <View style={{marginTop:12,padding:12,gap:6,backgroundColor:'#F2F5FA',borderRadius:12}}><Text style={ui.title}>日期信息</Text><Text style={ui.detail}>公历 · 农历 · 节气 · 传统节日</Text><Text style={ui.detail}>{projection.data?.holidays.reason??'法定节假日与调休安排尚未同步'}</Text><Text style={ui.detail}>天气：{projection.data?.weather.reason??'尚未获取可信天气来源'}；仅展示已授权来源有效预报。</Text></View>
 </ScrollView></View></View></Modal>;
}
