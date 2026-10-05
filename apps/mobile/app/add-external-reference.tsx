import {useQueryClient} from '@tanstack/react-query';
import {parseShareReceipt,parseShareText,EXTERNAL_REFERENCE_KINDS,EXTERNAL_REFERENCE_DOMAINS,suggestReferenceDomain,type ExternalReferenceDomain,type ExternalReferenceKind} from '@lazy-armor/plan-schema/share';
import {router,useLocalSearchParams} from 'expo-router';
import {useEffect,useState} from 'react';
import {NativeModules,Pressable,Text,View} from 'react-native';
import {Button,Card,EditorPage,Field,ui} from '../src/editor-ui';
import {useAuthStore} from '../src/auth-store';
import {api} from '../src/api';
import {recordSharedArtifactEvidence,syncLocalCapabilities} from '../src/local-capability-client';
interface Pending {rawText:string;mimeType:string;children:string[];fileName:string}
export default function AddExternalReference(){
 const client=useQueryClient();
 const {shareReceiptId,expectedKind}=useLocalSearchParams<{shareReceiptId?:string;expectedKind?:string}>();const token=useAuthStore(s=>s.token);
 const [rawText,setRawText]=useState(''),[mimeType,setMimeType]=useState<'text/plain'|'text/html'>('text/plain'),[children,setChildren]=useState<string[]>([]);
 const [domain,setDomain]=useState<ExternalReferenceDomain|null>(null),[editKind,setEditKind]=useState(false),[editDomain,setEditDomain]=useState(false);
 const kindLabels={SERVICE:'服务',PRODUCT:'商品',PLACE:'地点',CONTENT:'内容',OTHER:'其他',DOCUMENT:'文档',EVENT:'事件'};
 const domainLabels={life:'生活',family:'家庭',travel:'出行',health:'健康',work:'工作',other:'其他'};
 const [title,setTitle]=useState(''),[kind,setKind]=useState<ExternalReferenceKind>('OTHER'),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[binary,setBinary]=useState(false);
 const draft=parseShareReceipt({receiptId:shareReceiptId??'user-paste-preview',acquisitionMode:shareReceiptId?'SHARE':'PASTE',payload:{rawText,mimeType},receivedAt:new Date().toISOString(),evidenceRefs:shareReceiptId?[`native-receipt:${shareReceiptId}`]:[]});
 function accept(text:string,mime:'text/plain'|'text/html'='text/plain'){setRawText(text);setMimeType(mime);const parsed=parseShareText({rawText:text,mimeType:mime});setSelected(parsed.sourceUrl);setTitle(parsed.titleCandidate??'');setKind(parsed.kindCandidate);setDomain(suggestReferenceDomain(parsed.titleCandidate??text));setEditKind(false);}
 useEffect(()=>{let alive=true;if(token&&shareReceiptId)void(async()=>{try{const account=await syncLocalCapabilities(token);const value=await NativeModules.LazyArmorDeviceBridge.pendingShareArtifact(account,shareReceiptId);if(!value)throw new Error('分享证据已失效，请重新分享');const p=JSON.parse(value) as Pending;if(alive){setChildren(p.children);setBinary(!p.mimeType.startsWith('text/'));accept(p.rawText,p.mimeType==='text/html'?'text/html':'text/plain');}}catch(e){if(alive)setError(String(e));}})();return()=>{alive=false;};},[token,shareReceiptId]);
 async function save(){if(!token)return setError('请先登录');if(!binary&&draft.status!=='NO_URL'&&(!selected||!draft.urls.includes(selected)))return setError('请确认一个主链接');if(selected&&!title.trim())return setError('请补充标题');setBusy(true);setError('');try{
  const evidence=shareReceiptId?await recordSharedArtifactEvidence(token,shareReceiptId):null;
  for(const id of children)await recordSharedArtifactEvidence(token,id);
  if(binary||draft.status==='NO_URL'){if(!evidence)await api('/artifacts',token,{method:'POST',body:JSON.stringify({fileName:'pasted-share.txt',mimeType:'text/plain',contentBase64:btoa(unescape(encodeURIComponent(rawText))),requestId:`paste-${Date.now()}`})});}
  else await api('/external-references',token,{method:'POST',body:JSON.stringify({title:title.trim(),summary:'',sourceUrl:selected,sourcePlatform:draft.sourcePlatform??'UNKNOWN',domain:domain??undefined,kind,rawText,mimeType,importMethod:shareReceiptId?'SHARE':'MANUAL',evidenceArtifactId:evidence?.artifact.id})});
  await client.invalidateQueries({queryKey:['external-references']});await client.invalidateQueries({queryKey:['external-services']});
  router.replace('/external-references' as never);
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <EditorPage title="添加外部引用"><Card>
  {!shareReceiptId?<Button secondary label="从剪贴板粘贴" onPress={async()=>{try{if(!token)throw new Error('请先登录');await syncLocalCapabilities(token);const text=await NativeModules.LazyArmorDeviceBridge.readClipboardOnDemand();if(!text)throw new Error('剪贴板为空，请先在其它 App 复制内容');accept(text);}catch(e){setError(String(e));}}}/>:null}
  {!binary?<Field label="分享或复制的完整内容" value={rawText} onChange={value=>accept(value)} multiline max={12000}/>:<Text style={ui.detail}>图片或 PDF 将保存到文件证据链；识别结果仍需核实。</Text>}
  {draft.status==='AMBIGUOUS'?<Text style={ui.detail}>发现多个链接，请选择主链接。</Text>:null}
  {draft.urls.map(url=><Pressable key={url} onPress={()=>{setSelected(url);const chosen=parseShareText({rawText:url});if(chosen.kindCandidate==='PRODUCT')setKind('PRODUCT');}} style={ui.listRow}><Text selectable style={ui.detail}>{selected===url?'● ':'○ '}{url}</Text></Pressable>)}
  {selected?<><Field label="标题" value={title} onChange={setTitle} max={160}/><Text style={ui.detail}>来源：{draft.sourcePlatform} {draft.shareCode?` · 分享码：${draft.shareCode}`:''}</Text><Pressable onPress={()=>setEditKind(value=>!value)} style={ui.listRow}><Text style={ui.detail}>类型：{kindLabels[kind]}（可修改）</Text></Pressable>
  {editKind?<View style={[ui.line,{flexWrap:'wrap'}]}>{EXTERNAL_REFERENCE_KINDS.map(value=><Pressable key={value} onPress={()=>{setKind(value);setEditKind(false);}} style={ui.pill}><Text>{kindLabels[value]}</Text></Pressable>)}</View>:null}
  {expectedKind==='SERVICE'&&kind!=='SERVICE'?<Text style={ui.detail}>识别为{kindLabels[kind]}，将保存到外部引用，不会出现在我的外部服务。</Text>:null}
  <Pressable onPress={()=>setEditDomain(value=>!value)} style={ui.listRow}><Text style={ui.detail}>领域：{domain?domainLabels[domain]:'未指定'}（可选，可修改）</Text></Pressable>
  {editDomain?<View style={[ui.line,{flexWrap:'wrap'}]}>{[null,...EXTERNAL_REFERENCE_DOMAINS].map(value=><Pressable key={value??'none'} onPress={()=>{setDomain(value);setEditDomain(false);}} style={ui.pill}><Text>{value?domainLabels[value]:'未指定'}</Text></Pressable>)}</View>:null}</>:null}
  {!selected&&!binary?<Text style={ui.detail}>没有可靠链接，只保存原文文件证据。</Text>:null}
  {error?<Text style={ui.error}>{error}</Text>:null}<Button label={busy?'保存中…':selected?'确认保存引用':'保存文件证据'} disabled={busy||(!binary&&!rawText.trim())} onPress={()=>void save()}/>
 </Card></EditorPage>;
}
