import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Text,View} from 'react-native';
import {router} from 'expo-router';
import type {CreationDraft} from '@lazy-armor/plan-schema';
import {api} from './api';
import {Button,ui} from './editor-ui';
import {ConsumerPresentationMapper as presentation} from './consumer-presentation';
export interface DraftSourceOption {sourceId:string;demandIds:string[];name:string;status:string;canSelect:boolean;selected:boolean;primaryAction:{label:string;path:string};}
export function CreationDraftSources({token,draft,options,conversationId}:{token:string;draft:CreationDraft;options:DraftSourceOption[];conversationId:string|null}){
 const client=useQueryClient();
 const select=useMutation({mutationFn:(option:DraftSourceOption)=>api<CreationDraft>(`/creation-drafts/${draft.draftId}/sources`,token,{method:'POST',body:JSON.stringify({version:draft.version,sourceChoices:option.demandIds.map(demandId=>({demandId,sourceId:option.sourceId}))})}),onSuccess:async()=>{await Promise.all([client.invalidateQueries({queryKey:['conversation',token,conversationId]}),client.invalidateQueries({queryKey:['draft-gaps',token]})]);}});
 if(!options.length)return null;
 return <View style={{gap:8}}><Text style={ui.title}>真实数据来源</Text>{options.map(option=><View key={option.sourceId} style={{gap:4}}><Text style={ui.label}>{presentation.text(option.name,'数据来源')}</Text><Text style={ui.detail}>{presentation.text(option.status,'来源需要检查')}</Text>{option.canSelect?<Button secondary label={option.selected?'已选择此来源':'使用此来源'} disabled={option.selected||select.isPending} onPress={()=>select.mutate(option)}/>:<Button secondary label="管理来源" onPress={()=>router.push({pathname:'/resources',params:{returnConversationId:conversationId??'',returnMode:'plan'}} as never)}/>}</View>)}{select.isError?<Text style={ui.error}>{presentation.error(select.error)}</Text>:null}</View>;
}
