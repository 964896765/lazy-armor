import { useMutation, useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { ErrorState, LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import { connectionStartRequest, type ConnectorAuthorizationContract } from '../src/connection-api-contract';
WebBrowser.maybeCompleteAuthSession();
export default function ResourceProvider(){
 const {key}=useLocalSearchParams<{key:string}>();const token=useAuthStore(s=>s.token);
 const query=useQuery({queryKey:['resource-provider',key],queryFn:()=>api<ConnectorAuthorizationContract & {name:string;description:string}>(`/connectors/${encodeURIComponent(key)}`,token)});
 const supported = query.data && connectionStartRequest(query.data, 'lazyarmor:///oauth/callback') !== null;
 const connect=useMutation({mutationFn:async()=>{if(!query.data)return;const redirectUri=Linking.createURL('/oauth/callback',{queryParams:{provider:key}});const request=connectionStartRequest(query.data,redirectUri);if(!request)throw new Error('当前服务暂未开放');const start=await api<{authorizationUrl:string}>(request.path,token,request.init);const result=await WebBrowser.openAuthSessionAsync(start.authorizationUrl,redirectUri);if(result.type!=='success')return;const parsed=Linking.parse(result.url);router.push({pathname:'/oauth/callback',params:{provider:key,redirectUri,...parsed.queryParams}} as never);}});
 return <EditorPage title="云端资源详情">{query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:<>
 <Text style={ui.title}>{presentation.text(query.data?.name,'云端资源')}</Text>
 <Text style={ui.detail}>配置：{query.data?.productionStatus==='DISABLED'?'需要配置':'已配置适配'}</Text>
 <Text style={ui.detail}>授权：需要授权</Text><Text style={ui.detail}>健康：尚未检查</Text><Text style={ui.detail}>最近检查：暂无</Text>
 <Text style={[ui.label,{marginTop:16}]}>能力</Text>{(query.data as (typeof query.data & {capabilities?:Array<{key:string;name:string;draftOnly:boolean}>}))?.capabilities?.map(c=><Text key={c.key} style={ui.detail}>{c.name} · {c.draftOnly?'待接入':'需要授权与健康检查'}</Text>)}
 <Text style={ui.detail}>{supported?'完成授权后还需逐项检查权限、健康和证据。':'此 Provider 需要先完成服务器配置；不表示已连接或能力可用。'}</Text>
 <Button label={connect.isPending?'正在打开授权…':'授权连接'} disabled={connect.isPending||!token||!supported} onPress={()=>connect.mutate()}/>{connect.isError?<Text style={ui.error}>{presentation.error(connect.error)}</Text>:null}
 </>}</EditorPage>;
}
