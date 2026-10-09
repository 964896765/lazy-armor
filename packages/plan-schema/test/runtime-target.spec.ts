import {describe,it,expect} from 'vitest';
import {runtimeTargetFreshness,assertRuntimeTargetEpoch,runtimeTargetSchema} from '../src/runtime-target';
describe('RuntimeTarget contract',()=>{
 it('fails closed on stale, future and unknown heartbeats',()=>{const now='2026-10-05T00:01:00.000Z';expect(runtimeTargetFreshness('2026-10-05T00:00:59.000Z',now,30000)).toBe('ONLINE');expect(runtimeTargetFreshness('2026-10-05T00:00:00.000Z',now,30000)).toBe('OFFLINE');expect(runtimeTargetFreshness(null,now,30000)).toBe('UNKNOWN');expect(runtimeTargetFreshness('2026-10-05T00:02:00.000Z',now,30000)).toBe('UNKNOWN');});
 it('fences stale authority and unavailable targets independently of success',()=>{expect(()=>assertRuntimeTargetEpoch({authorityEpoch:2,health:'HEALTHY'},1)).toThrow('STALE_AUTHORITY_EPOCH');expect(()=>assertRuntimeTargetEpoch({authorityEpoch:2,health:'UNAVAILABLE'},2)).toThrow('TARGET_UNAVAILABLE');});
 it('rejects invalid type, epoch and manifest hash',()=>{expect(runtimeTargetSchema.safeParse({targetType:'APP',authorityEpoch:0,manifestHash:'fake'}).success).toBe(false);});
});
