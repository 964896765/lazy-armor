import { Platform } from 'react-native';
import { api } from './api';
import type { SessionTokens } from './secure-token-store';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

export function passkeyAvailable(capability?:{available:boolean;origins:string[]}):boolean {
  return Boolean(capability?.available&&Platform.OS==='web'&&typeof window!=='undefined'&&window.isSecureContext&&typeof window.PublicKeyCredential==='function'&&typeof navigator.credentials?.create==='function'&&typeof navigator.credentials?.get==='function'&&capability.origins.includes(window.location.origin));
}
export async function loginWithPasskey(isCurrent:()=>boolean=()=>true):Promise<SessionTokens> {
  const {startAuthentication}=await import('@simplewebauthn/browser');
  const grant=await api<{challenge:string;options:PublicKeyCredentialRequestOptionsJSON}>('/auth/passkeys/login/options',undefined,{method:'POST',body:'{}'});
  if(!isCurrent())throw new Error('登录会话已变化，请重新开始。');
  const credential=await startAuthentication({optionsJSON:grant.options});
  if(!isCurrent())throw new Error('登录会话已变化，请重新开始。');
  const tokens=await api<SessionTokens>('/auth/passkeys/login/verify',undefined,{method:'POST',body:JSON.stringify({challenge:grant.challenge,credential})});
  if(!isCurrent()){await api('/auth/logout',undefined,{method:'POST',body:JSON.stringify({refreshToken:tokens.refreshToken})}).catch(()=>undefined);throw new Error('登录会话已变化，请重新开始。');}
  return tokens;
}
export async function registerWithPasskey(token:string,challenge:string,isCurrent:()=>boolean):Promise<void> {
  const {startRegistration}=await import('@simplewebauthn/browser');
  const grant=await api<{challenge:string;options:PublicKeyCredentialCreationOptionsJSON}>('/auth/passkeys/register/options',token,{method:'POST',body:JSON.stringify({challenge})});
  if(!isCurrent())return;
  const credential=await startRegistration({optionsJSON:grant.options});
  if(!isCurrent())return;
  await api('/auth/passkeys/register/verify',token,{method:'POST',body:JSON.stringify({challenge,credential})});
}
export function passkeyError(error:unknown):string|undefined {
  if(!(error instanceof Error))return;
  const wrapped=error as Error&{code?:string;cause?:Error};
  const name=wrapped.cause?.name??error.name;
  if(name==='InvalidStateError'||wrapped.code==='ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')return '此设备已保存这把通行密钥，请使用已有密钥或选择其他设备。';
  if(['NotAllowedError','AbortError'].includes(name)||wrapped.code==='ERROR_CEREMONY_ABORTED')return '设备验证已取消或超时。可以重试，也可使用验证码或密码。';
  if(error.name==='WebAuthnError')return '当前设备无法完成通行密钥验证，请使用验证码或密码。';
  return undefined;
}
