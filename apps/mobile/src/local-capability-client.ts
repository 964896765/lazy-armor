import {NativeModules,Platform} from 'react-native';
import {api} from './api';
import {deviceBoundApi} from './trusted-device-api';
export async function syncLocalCapabilities(token:string) {
 if(Platform.OS!=='android'||!NativeModules.LazyArmorDeviceBridge?.localCapabilities)throw new Error('请安装最新 Android 客户端');
 const user=await api<{id:string}>('/me',token);
 const body=await NativeModules.LazyArmorDeviceBridge.localCapabilities(user.id);
 await deviceBoundApi('/consumer/local-capabilities',token,{method:'POST',body});
 return user.id;
}

/** Existing Artifact bytes plus a signed native per-file receipt; not semantic Truth. */
export async function recordPickedArtifactEvidence(token:string,uri:string,artifact:{id:string;sourceSha256:string}){
 if(Platform.OS!=='android')return null;
 const native=NativeModules.LazyArmorDeviceBridge;
 if(typeof native?.artifactFileReceipt!=='function')throw new Error('请更新客户端以记录文件来源证据');
 const userId=await syncLocalCapabilities(token);
 const receipt=await native.artifactFileReceipt(userId,uri,artifact.id,artifact.sourceSha256);
 if(receipt===null)return null; // Grant off: attachment remains an unverified manual import.
 return deviceBoundApi('/consumer/local-acquisition',token,{method:'POST',body:receipt});
}

export async function recordSharedArtifactEvidence(token:string,receiptId:string|undefined){
 if(Platform.OS!=='android'||!receiptId)return null;
 const native=NativeModules.LazyArmorDeviceBridge;
 if(typeof native?.pendingShareArtifact!=='function'||typeof native?.artifactShareReceipt!=='function')throw new Error('请更新客户端以记录分享来源证据');
 const userId=await syncLocalCapabilities(token);
 const raw=await native.pendingShareArtifact(userId,receiptId);
 if(raw===null)throw new Error('分享授权或来源证据已失效，请重新分享');
 const pending=JSON.parse(raw) as {contentBase64:string;mimeType:string;fileName:string};
 const artifact=await api<{id:string;sourceSha256:string}>('/artifacts',token,{method:'POST',body:JSON.stringify({fileName:pending.fileName,mimeType:pending.mimeType,contentBase64:pending.contentBase64,requestId:'android-share-'+receiptId})});
 const receipt=await native.artifactShareReceipt(userId,receiptId,artifact.id,artifact.sourceSha256);
 const acquisition=await deviceBoundApi('/consumer/local-acquisition',token,{method:'POST',body:receipt});
 return {artifact,acquisition};
}
