import * as SecureStore from 'expo-secure-store';
import { memoryAuthClientMarker } from './auth-client-marker-id';
const key='lazy-armor-sms-client-marker';
let pending:Promise<string>|undefined;
export function authClientMarker():Promise<string>{
 if(!pending)pending=(async()=>{
  let timer:ReturnType<typeof setTimeout>;
  const load=(async()=>{
  try{
   if(!await SecureStore.isAvailableAsync())return memoryAuthClientMarker();
   const raw=await SecureStore.getItemAsync(key);
   let value:unknown;try{value=raw?JSON.parse(raw):undefined;}catch{}
   if(value&&typeof value==='object'&&'id' in value&&'createdAt' in value&&typeof value.id==='string'&&/^[-A-Za-z0-9_]{8,128}$/.test(value.id)&&typeof value.createdAt==='number'&&value.createdAt<=Date.now()&&Date.now()-value.createdAt<30*86400000)return value.id;
   const id=memoryAuthClientMarker();await SecureStore.setItemAsync(key,JSON.stringify({id,createdAt:Date.now()}),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});return id;
  }catch{return memoryAuthClientMarker();}
  })();
  try{return await Promise.race([load,new Promise<string>(resolve=>{timer=setTimeout(()=>resolve(memoryAuthClientMarker()),1000);})]);}finally{clearTimeout(timer!);}
 })();
 return pending;
}
