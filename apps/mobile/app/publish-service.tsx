import { ConsumerPresentationMapper as presentation } from '../src/consumer-presentation';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Text, View } from 'react-native';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { Button, EditorPage, Field, ui } from '../src/editor-ui';
import {newServiceOfferingForm,serviceOfferingPayload,ServiceOfferingFields} from '../src/service-offering-form';
import {serviceDeliveryLabels,servicePriceLabels} from '@lazy-armor/plan-schema/service-offering';
export default function PublishService() {
 const token = useAuthStore(s => s.token); const client = useQueryClient();
 const [form,setForm]=useState(newServiceOfferingForm);const [imageUrl,setImageUrl]=useState('');const [error,setError]=useState('');
 const [imageMedia, setImageMedia] = useState<{ id: string; uri: string } | null>(null);
 const upload = useMutation({ mutationFn: async () => {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true, multiple: false });
  if (picked.canceled) return null; const asset = picked.assets[0];
  if (!asset?.size || asset.size > 8000000) throw new Error('请选择最大 8 MB 的静态图片');
  const contentBase64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const result = await api<{ id: string }>('/service-media', token, { method: 'POST', body: JSON.stringify({ requestId: `image-${Date.now()}-${Math.random().toString(36).slice(2)}`, contentBase64 }) });
  return { id: result.id, uri: asset.uri };
 }, onSuccess: image => { if (image) { setImageMedia(image); setImageUrl(''); } setError(''); }, onError: e => setError(e.message) });
 const [requestId] = useState(() => `publish-${Date.now()}-${Math.random().toString(36).slice(2)}`);
 const publish = useMutation({ mutationFn: (status:'PUBLISHED'|'DRAFT'='PUBLISHED') => {
  const fields=serviceOfferingPayload(form);
  return api('/service-offerings', token, { method: 'POST', body: JSON.stringify({ requestId, status, ...fields, ...(imageMedia ? { imageMediaId: imageMedia.id } : {}), ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}), confirmed: true }) });
 }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ['service-offerings'] }); await client.invalidateQueries({ queryKey: ['service-provider-profile'] }); await client.invalidateQueries({queryKey:['my-service-offerings']}); router.canGoBack() ? router.back() : router.replace('/services' as never); }, onError: e => setError(e.message) });
 return <EditorPage title="发布内部服务">{!token ? <Button label="登录后发布服务" onPress={() => router.push('/auth/login' as never)} /> : <>
  <ServiceOfferingFields value={form} onChange={setForm} imageFields={<>
   <Field label="服务图片链接（选填）" value={imageUrl} onChange={value=>{setImageUrl(value);if(value.trim())setImageMedia(null);}} max={1000} placeholder="公开 HTTPS 图片地址"/>
   <Button secondary label={upload.isPending?'上传中…':'从手机选择服务图片'} disabled={upload.isPending||publish.isPending} onPress={()=>upload.mutate()}/>
   {imageMedia?<><Image source={{uri:imageMedia.uri}} style={{width:'100%',height:160}} resizeMode="contain"/><Button secondary label="移除图片" onPress={()=>setImageMedia(null)}/></>:null}
   <Text style={ui.detail}>图片确认发布后公开展示，上传时会去除定位等元数据。</Text>
  </>}/>
  <View style={{gap:8,paddingTop:16}}><Text style={ui.title}>发布</Text><Button secondary label="保存草稿" disabled={publish.isPending||upload.isPending} onPress={()=>publish.mutate('DRAFT')}/>
  {error?<Text style={ui.error}>{presentation.error(error)}</Text>:null}
  <Button label={publish.isPending?'发布中…':'确认发布服务'} disabled={publish.isPending||upload.isPending} onPress={()=>{
   try{serviceOfferingPayload(form);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));return;}
   Alert.alert('确认公开发布？',`${form.title}\n${form.deliveryMode?serviceDeliveryLabels[form.deliveryMode]:''}\n公开联系方式：${form.contact}\n费用：${servicePriceLabels[form.priceMode]}${['FIXED','STARTING_FROM'].includes(form.priceMode)?' '+form.price+' 元':''}`,[{text:'取消'},{text:'确认发布',onPress:()=>publish.mutate('PUBLISHED')}]);
  }}/></View>
 </>}</EditorPage>;
}
