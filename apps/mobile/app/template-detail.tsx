import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, Card, EditorPage, ui } from '../src/editor-ui';
import { ErrorState, LoadingState } from '../src/consumer-ui';
import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
export default function TemplateDetail() {
 const params = useLocalSearchParams<{templateKey?:string;scenarioKey?:string}>();
 const token = useAuthStore(s=>s.token);
 const query = useQuery({queryKey:['template-detail',params.templateKey,params.scenarioKey],queryFn:()=>api<{name?:string;label?:string;description?:string;details?:{doesWhat?:string;runsWhen?:string;connectionSummary?:string};doesWhat?:string;runsWhen?:string;dataNeeded?:string[];remindsWhen?:string;connectionSummary?:string;riskSummary?:string}>(params.templateKey ? `/templates/${encodeURIComponent(params.templateKey)}` : `/scenarios/${encodeURIComponent(params.scenarioKey ?? '')}`,token)});
 return <EditorPage title="模板详情">{query.isLoading ? <LoadingState/> : query.isError ? <ErrorState onRetry={()=>void query.refetch()}/> : <><Card title={presentation.text(query.data?.name ?? query.data?.label,'计划模板')}><Text style={ui.detail}>{presentation.text(query.data?.details?.doesWhat ?? query.data?.description,'在计划会话中描述长期需求，补充资源并确认运行方式。')}</Text>{query.data?.details?.runsWhen ? <Text style={ui.detail}>运行方式：{presentation.text(query.data.details.runsWhen)}</Text>:null}{query.data?.details?.connectionSummary ? <Text style={ui.detail}>{presentation.text(query.data.details.connectionSummary)}</Text>:null}<Text style={ui.detail}>资源未就绪也可以开始创建。会话将保留草案，并列出需要补充的信息与授权。</Text></Card><Button label="使用模板" onPress={()=>router.push({pathname:'/chat',params:{mode:'plan',...(params.templateKey?{templateKey:params.templateKey}:{scenarioKey:params.scenarioKey})}} as never)}/></>}</EditorPage>;
}
