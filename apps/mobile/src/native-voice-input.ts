import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { api } from './api';
import { useAuthStore } from './auth-store';
import type { VoiceInputProvider } from './voice-input-provider';
let recognitionGeneration=0;
export const nativeVoiceInputProvider: VoiceInputProvider = {
  async start(onTranscribing) {
    const generation=++recognitionGeneration;
    const bridge = NativeModules.LazyArmorDeviceBridge;
    if (Platform.OS !== 'android' || !bridge?.startSpeechRecognition) throw new Error('当前设备尚不支持语音输入');
    const subscription = DeviceEventEmitter.addListener('LazyArmorVoiceState', state => { if (state === 'TRANSCRIBING') onTranscribing(); });
    try { const token=useAuthStore.getState().token;if(!token)throw new Error('请先登录');const user=await api<{id:string}>('/me',token);if(generation!==recognitionGeneration)throw new Error('语音输入已取消');return await bridge.startSpeechRecognition(user.id,'zh-CN'); }
    finally { subscription.remove(); }
  },
  async cancel() { ++recognitionGeneration; await NativeModules.LazyArmorDeviceBridge?.cancelSpeechRecognition?.(); },
};
