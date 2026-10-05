import {newServiceOfferingForm,offeringToForm,serviceOfferingPayload,ServiceOfferingFields} from '../src/service-offering-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, EditorPage, Field, ui } from '../src/editor-ui';
import { ErrorState, LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
interface Offering extends Record<string,unknown> { id:string;title:string;summary:string;serviceArea:string|null;contact:string|null;priceMinMinor:number|null;status:string;updatedAt:string }
export default function ManageServiceOffering(){
 const {id}=useLocalSearchParams<{id:string}>();const token=useAuthStore(s=>s.token);const client=useQueryClient();
 const query=useQuery({queryKey:['my-service-offerings',token],enabled:Boolean(token),queryFn:()=>api<Offering[]>('/my-service-offerings',token)});
 const item=query.data?.find(row=>row.id===id);
 const [form,setForm]=useState(newServiceOfferingForm);
 useEffect(()=>{if(item)setForm(offeringToForm(item));},[item]);
 const update=useMutation({mutationFn:async(status:string)=>{
  if(!item)throw new Error('请刷新服务信息');
  return api(`/my-service-offerings/${id}`,token,{method:'POST',body:JSON.stringify({expectedUpdatedAt:item.updatedAt,...serviceOfferingPayload(form),status,confirmed:true})});
 },onSuccess:async()=>{await client.invalidateQueries({queryKey:['my-service-offerings']});await client.invalidateQueries({queryKey:['service-offerings']});}});
 function confirm(status:string,label:string){Alert.alert(label+'？','确认后将更新服务目录；已有服务请求仍可在收到的请求中处理。',[{text:'取消'},{text:'确认',onPress:()=>update.mutate(status)}]);}
 return <EditorPage title="管理服务">{query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:!item?<Text style={ui.detail}>未找到可管理的服务</Text>:<>
  <ServiceOfferingFields value={form} onChange={setForm}/><Text style={[ui.title,{marginTop:16}]}>发布</Text>
  <Button label="保存修改" disabled={update.isPending} onPress={()=>confirm(item.status,'保存修改')}/>
  {item.status==='PUBLISHED'?<Button secondary label="下架服务" disabled={update.isPending} onPress={()=>confirm('UNPUBLISHED','下架服务')}/>:<Button label="确认发布" disabled={update.isPending} onPress={()=>confirm('PUBLISHED','发布服务')}/>}
  <Button secondary label="查看收到的请求" onPress={()=>router.push({pathname:'/service-requests',params:{role:'provider',offeringId:id}} as never)}/>
 </>}{update.isError?<Text style={ui.error}>{presentation.error(update.error)}</Text>:null}</EditorPage>;
}
