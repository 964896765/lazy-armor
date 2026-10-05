import { Ionicons } from '@expo/vector-icons';
import { useRef,useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useVoiceInput } from './use-voice-input';
import { ui } from './editor-ui';
import { consumerTokens } from './consumer-ui';
export function ConversationComposer({value,onChange,mode,busy,disabled,attaching,onAttach,onSend,onStop,onRetry,failed,attachments,onRemoveAttachment}:{value:string;onChange:(value:string)=>void;mode:'TEMPORARY'|'PLAN';busy:boolean;disabled:boolean;attaching:boolean;onAttach:()=>void;onSend:()=>void;onStop:()=>void;onRetry:()=>void;failed:boolean;attachments:Array<{id:string;fileName:string}>;onRemoveAttachment:(id:string)=>void}){
 const latestValue=useRef(value);latestValue.current=value;
 const voice=useVoiceInput();const {height:windowHeight}=useWindowDimensions();const maxInputHeight=Math.max(120,Math.min(240,windowHeight*0.3));const [height,setHeight]=useState(56);const voiceBusy=voice.state==='LISTENING'||voice.state==='TRANSCRIBING';
 return <View style={{paddingHorizontal:14,paddingBottom:8,gap:4}}>
  {attachments.map(file=><Pressable key={file.id} accessibilityLabel={'移除附件'+file.fileName} disabled={busy} onPress={()=>onRemoveAttachment(file.id)}><Text numberOfLines={1} style={ui.detail}>{file.fileName} · 移除</Text></Pressable>)}
  {voiceBusy?<View style={ui.line}><Text style={[ui.detail,{flex:1}]}>{voice.state==='LISTENING'?'正在聆听…':'正在识别…'}</Text><Pressable accessibilityLabel="取消语音输入" style={ui.back} onPress={()=>void voice.cancel()}><Text style={ui.detail}>取消</Text></Pressable></View>:null}
  {voice.error?<Text style={ui.error}>{voice.error}</Text>:null}
  {failed&&!busy?<Pressable accessibilityRole="button" onPress={onRetry}><Text style={{color:consumerTokens.primary}}>重试本条消息</Text></Pressable>:null}
  <View style={[ui.card,{padding:10,gap:4}]}>
   <TextInput accessibilityLabel="会话需求" value={value} onChangeText={onChange} placeholder={mode==='PLAN'?'描述长期计划需求':'问我任何临时需求'} multiline maxLength={12000} scrollEnabled blurOnSubmit={false} editable={!busy&&!disabled&&!voiceBusy} onContentSizeChange={event=>setHeight(Math.max(56,event.nativeEvent.contentSize.height))} style={{width:'100%',height:Math.min(height,maxInputHeight),minHeight:56,paddingHorizontal:4,paddingVertical:8,color:consumerTokens.text,fontSize:16,lineHeight:24,textAlignVertical:'top',textAlign:'left'}}/>
   <View style={[ui.line,{justifyContent:'space-between'}]}>
   <Pressable accessibilityLabel="添加文档附件" style={ui.back} disabled={disabled||busy||attaching||voiceBusy} onPress={onAttach}><Ionicons name="attach" size={25} color={consumerTokens.secondary}/></Pressable>

   <View style={{flex:1}}/>
   <Pressable accessibilityLabel={voiceBusy?'取消语音输入':'语音输入'} style={ui.back} disabled={disabled||busy||attaching} onPress={async()=>{if(voiceBusy){await voice.cancel();return;}Keyboard.dismiss();const text=await voice.start();if(text)onChange((latestValue.current?latestValue.current+'\n':'')+text);}}><Ionicons name={voiceBusy?'mic':'mic-outline'} size={25} color={consumerTokens.secondary}/></Pressable>
   <Pressable accessibilityLabel={busy?'停止等待':'发送'} style={ui.back} disabled={!busy&&(disabled||attaching||voiceBusy||!value.trim())} onPress={busy?onStop:onSend}><Ionicons name={busy?'stop-circle-outline':'send'} size={27} color={consumerTokens.primary}/></Pressable>
   </View>
  </View>{busy?<Text style={ui.detail}>正在生成回复 · 停止等待后可刷新查看后台结果</Text>:null}
 </View>;
}
