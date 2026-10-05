import {referenceKindLabels,referenceDomainLabels} from '../src/external-reference-views';
import type {ExternalReferenceKind,ExternalReferenceDomain} from '@lazy-armor/plan-schema/share';
import {useQuery} from '@tanstack/react-query';
import {router,useLocalSearchParams} from 'expo-router';
import {Text} from 'react-native';
import * as Browser from 'expo-web-browser';
import {api} from '../src/api';
import {useAuthStore} from '../src/auth-store';
import {Button,Card,EditorPage,ui} from '../src/editor-ui';
export default function Reference(){const {id}=useLocalSearchParams<{id:string}>();const token=useAuthStore(s=>s.token);const q=useQuery({queryKey:['external-reference',token,id],queryFn:()=>api<{id:string;kind:ExternalReferenceKind;domain:ExternalReferenceDomain|null;title:string;sourceUrl:string;rawText:string|null;sourcePlatform:string;shareCode:string|null}>('/external-references/'+id,token),enabled:!!token&&!!id});const r=q.data;return <EditorPage title="外部引用">{r?<><Card title={r.title}><Text style={ui.detail}>{referenceKindLabels[r.kind]}{r.domain?' · '+referenceDomainLabels[r.domain]:''} · {r.sourcePlatform}</Text><Text selectable style={ui.detail}>{r.sourceUrl}</Text><Text style={ui.detail}>这是保存的来源引用，当前价格、库存或状态尚未核实。</Text>{r.shareCode?<Text style={ui.detail}>分享码：{r.shareCode}</Text>:null}</Card><Button label="打开原链接" onPress={()=>{void Browser.openBrowserAsync(r.sourceUrl);}}/><Button secondary label="在会话中使用" onPress={()=>router.push({pathname:'/chat',params:{externalReferenceId:r.id}} as never)}/><Button secondary label="围绕此引用创建计划草案" onPress={()=>router.push({pathname:'/chat',params:{mode:'plan',externalReferenceId:r.id}} as never)}/>{r.rawText?<Card title="来源原文"><Text selectable style={ui.detail}>{r.rawText}</Text></Card>:null}</>:q.isError?<Text style={ui.error}>读取失败</Text>:null}</EditorPage>;}
