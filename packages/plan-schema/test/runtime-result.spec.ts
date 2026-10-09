import {describe,it,expect} from 'vitest';
import {runtimeResultDeliveryState} from '../src/runtime-result';
import {capabilityInvocationSchema} from '../src/capability-invocation';
describe('Invocation and Result authority contracts',()=>{
 it('keeps delivery acknowledgement independent of execution and verification',()=>{expect(runtimeResultDeliveryState({ackAt:null,lastDeliveredAt:null})).toBe('RESULT_PENDING_DELIVERY');expect(runtimeResultDeliveryState({ackAt:null,lastDeliveredAt:'2026-10-05T00:00:00Z'})).toBe('RESULT_DELIVERED');expect(runtimeResultDeliveryState({ackAt:'2026-10-05T00:00:01Z',lastDeliveredAt:'2026-10-05T00:00:00Z'})).toBe('RESULT_ACKNOWLEDGED');});
 it('rejects missing PlanVersion/resolution or invalid epoch/timeout',()=>{expect(capabilityInvocationSchema.safeParse({capabilityId:'email.send',authorityEpoch:0,timeoutMs:0}).success).toBe(false);});
});
