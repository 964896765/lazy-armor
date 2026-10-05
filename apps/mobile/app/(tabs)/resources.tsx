import { HeaderIconButton } from '../../src/header-icon-button';
import { SegmentedControl, ErrorState, LoadingState } from '../../src/consumer-ui';
import { ConsumerPresentationMapper as presentation } from '../../src/consumer-presentation';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ResourceProjection } from '@lazy-armor/plan-schema';
import { api } from '../../src/api';
import { useAuthStore } from '../../src/auth-store';
import { Button, ui } from '../../src/editor-ui';
import { LocalResourceList } from '../../src/local-resource-list';

const tabs = [{ kind: 'LOCAL', label: '本机' }, { kind: 'CLOUD', label: '云端' }, { kind: 'DEVICE', label: '其它设备' }, { kind: 'INTERFACE', label: '接口' }] as const;

export default function Resources() {
 const params=useLocalSearchParams<{returnConversationId?:string;returnMode?:string}>();
 const token = useAuthStore(s => s.token);
 const [kind, setKind] = useState<ResourceProjection['kind']>('LOCAL');
 const [showMore, setShowMore] = useState(false);
 const [addOpen, setAddOpen] = useState(false);
 const query = useQuery({ queryKey: ['resources', token], queryFn: () => api<ResourceProjection[]>('/consumer/resources', token), enabled: Boolean(token) });
 const resources = (query.data ?? []).filter(item => item.kind === kind && (showMore || item.status !== '不可用'));
 const moreCount = (query.data ?? []).filter(item => item.kind === kind && item.status === '不可用').length;
 return <SafeAreaView edges={['top']} style={{ flex: 1 }}><ScrollView contentContainerStyle={ui.content}>
  <View style={ui.line}><Text style={[ui.pageTitle,{textAlign:'left'}]}>资源</Text><HeaderIconButton label="添加资源" icon="add" onPress={() => kind === 'CLOUD' ? setAddOpen(true) : router.push((kind === 'DEVICE' ? '/connected-devices' : kind === 'INTERFACE' ? '/add-interface' : '/connections/add') as never)}/></View><Text style={ui.detail}>管理计划所需的数据、设备与接口；授权后按需使用。</Text>
  <SegmentedControl value={kind} options={tabs.map(tab=>({value:tab.kind,label:tab.label}))} onChange={setKind}/>
  {params.returnConversationId ? <Button secondary label="返回计划会话" onPress={()=>router.replace({pathname:'/chat',params:{mode:params.returnMode??'plan',conversationId:params.returnConversationId}} as never)}/> : null}
  {kind === 'LOCAL' ? <>
   <LocalResourceList/>
  </> : !token ? <Button label="登录后连接资源" onPress={() => router.push('/auth/login' as never)} /> : query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <>
   {resources.map(item => <Pressable key={item.resourceId} style={ui.listRow} onPress={() => router.push(item.primaryAction.path as never)}><View style={[ui.line, { justifyContent: 'space-between' }]}><Text style={ui.title}>{presentation.text(item.name,'资源')}</Text><Text style={{ color: '#287BFF' }}>{item.status} ›</Text></View><Text style={ui.detail}>{presentation.text(item.summary)}</Text>{item.reasons.length ? <Text style={ui.detail}>{item.reasons.map(reason => presentation.reason(reason)).join(' · ')}</Text> : null}</Pressable>)}
   {!resources.length ? <View style={ui.listRow}><Text style={ui.detail}>{kind === 'DEVICE' ? '暂无已认证设备' : kind === 'INTERFACE' ? '暂无已添加接口' : '暂无云端连接'}</Text></View> : null}
   {moreCount ? <Button secondary label={showMore ? '收起暂未开放的资源' : `更多资源 · ${moreCount} 项待开放`} onPress={()=>setShowMore(!showMore)} /> : null}
   {kind === 'DEVICE' ? <Button secondary label="连接设备" onPress={() => router.push('/connected-devices' as never)} /> : kind === 'INTERFACE' ? <Button secondary label="添加接口" onPress={() => router.push('/add-interface' as never)} /> : null}
  </>}
 </ScrollView><Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,24,40,0.28)' }}><SafeAreaView edges={['bottom']} style={{ maxHeight: '75%', backgroundColor: 'rgba(235,243,252,0.92)', padding: 12 }}><View style={ui.line}><Text style={[ui.title, { flex: 1 }]}>添加云端资源</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭添加资源" style={ui.back} onPress={() => setAddOpen(false)}><Ionicons name="close" size={22} color="#172033" /></Pressable></View><ScrollView>{!token ? <Button label="登录后连接资源" onPress={() => { setAddOpen(false); router.push('/auth/login' as never); }} /> : query.isLoading ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <>{(query.data ?? []).filter(item => item.kind === 'CLOUD' && item.sourceRef.type === 'Connector' && item.status !== '不可用').map(item => <Pressable key={item.resourceId} accessibilityRole="button" style={ui.listRow} onPress={() => { setAddOpen(false); router.push(item.primaryAction.path as never); }}><Text style={ui.title}>{presentation.text(item.name, '云端资源')}</Text><Text style={ui.detail}>{presentation.text(item.summary)}</Text></Pressable>)}{!(query.data ?? []).some(item => item.kind === 'CLOUD' && item.sourceRef.type === 'Connector' && item.status !== '不可用') ? <Text style={ui.detail}>暂无可新增的云端资源；未开放的服务不会显示为可连接。</Text> : null}</>}</ScrollView></SafeAreaView></View></Modal></SafeAreaView>;
}
