import {describe,expect,it} from 'vitest';import {resourceConnectionStatus} from '../src/consumer/resource-projection-policy';
describe('Provider status does not imply execution capability',()=>{
 it.each([['CONNECTED','已连接'],['CONFIG_MISSING','需要配置'],['AUTH_REQUIRED','需要授权'],['REAUTH_REQUIRED','需重新授权'],['DEGRADED','部分可用'],['OFFLINE','设备离线'],['UNAVAILABLE','暂不可用']])('maps %s', (state,label)=>expect(resourceConnectionStatus(state)).toBe(label));
 it('health reauthorization fences a connected Provider',()=>expect(resourceConnectionStatus('connected',['REAUTHORIZATION_REQUIRED'])).toBe('需重新授权'));
 it('does not collapse partial health into offline',()=>expect(resourceConnectionStatus('connected',['DEGRADED'])).toBe('部分可用'));
});
