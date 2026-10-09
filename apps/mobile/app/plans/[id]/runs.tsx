import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {router,useLocalSearchParams} from 'expo-router';
import {Pressable,Text,View} from 'react-native';
import {api} from '../../../src/api';
import {useAuthStore} from '../../../src/auth-store';
import {EditorPage,Button,ui} from '../../../src/editor-ui';
import {LoadingState,ErrorState,EmptyState} from '../../../src/consumer-ui';
import {executionStatusLabel} from '../../../src/execution-presenter';
import {formatTime} from '../../../src/plan-presenter';
import {controlVerificationLabel,type PlanControlProjection} from '../../../src/plan-control-presenter';
interface Run {id:string;status:string;createdAt:string;resultState?:string|null}
export default function PlanRuns(){
 const {id}=useLocalSearchParams<{id:string}>();const token=useAuthStore(s=>s.token);const [cursor,setCursor]=useState<string|undefined>();
 const control=useQuery({queryKey:['plan-control',id,token],queryFn:()=>api<PlanControlProjection>(`/plans/${id}/control-projection`,token),enabled:Boolean(id&&token)});
 const query=useQuery({queryKey:['plan-runs-page',id,cursor,token],queryFn:()=>api<{items:Run[];nextCursor:string|null}>(`/executions/page?planId=${id}&limit=20${cursor?'&cursor='+encodeURIComponent(cursor):''}`,token),enabled:Boolean(id&&token)});
 return <EditorPage title="运行记录">{query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:query.data?.items.length?<View>{query.data.items.map(run=><Pressable key={run.id} accessibilityRole="button" onPress={()=>router.push(`/executions/${run.id}` as never)} style={[ui.row,{minHeight:64}]}><View style={{flex:1}}><Text style={ui.title}>{formatTime(run.createdAt)}</Text><Text style={ui.detail}>{run.resultState==='OUTCOME_UNKNOWN'?'结果待确认，正在核对':executionStatusLabel(run.status)}{control.data?.records?.find(record=>record.id===run.id)?' · '+controlVerificationLabel(control.data.records.find(record=>record.id===run.id)!.verificationState):''}</Text></View><Text style={ui.detail}>›</Text></Pressable>)}</View>:<EmptyState title="还没有运行记录"/>}{query.data?.nextCursor?<Button secondary label="下一页" onPress={()=>setCursor(query.data!.nextCursor!)}/>:null}{cursor?<Button secondary label="返回最近记录" onPress={()=>setCursor(undefined)}/>:null}</EditorPage>;
}
