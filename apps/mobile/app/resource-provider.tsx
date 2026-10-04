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
 return <EditorPage title="连接资源">{query.isLoading?<LoadingState/>:query.isError?<ErrorState onRetry={()=>void query.refetch()}/>:<Card title={presentation.text(query.data?.name,'云端资源')}><Text style={ui.detail}>{presentation.text(query.data?.description)}</Text><Text style={ui.detail}>{supported ? '连接后仍需确认数据权限，可用能力由服务器检查。' : '当前资源尚未开放连接。开放后可在资源页完成配置。'}</Text><Button label={connect.isPending?'正在打开授权…':'连接'} disabled={connect.isPending||!token||!supported} onPress={()=>connect.mutate()}/>{connect.isError?<Text style={ui.error}>{presentation.error(connect.error)}</Text>:null}</Card>}</EditorPage>;
}
