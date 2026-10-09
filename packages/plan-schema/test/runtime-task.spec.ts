import {describe,it,expect} from 'vitest';
import {projectRuntimeTask} from '../src/runtime-task';
const base={invocationId:'invocation',targetId:'target',runtimeKind:'EXECUTION' as const,status:'running',attemptCount:2};
describe('durable runtime projection',()=>{
 it('preserves waiting, cancellation and outcome uncertainty',()=>{for(const [status,state] of Object.entries({waiting_approval:'WAITING_USER',waiting_reconciliation:'OUTCOME_UNKNOWN',waiting_verification:'WAITING_EXTERNAL',cancelled:'CANCELLED',partially_succeeded:'OUTCOME_UNKNOWN',succeeded:'SUCCEEDED'}))expect(projectRuntimeTask({...base,status}).state).toBe(state);});
 it('does not retry automatically or treat lease expiry as proof of failure',()=>{const projection=projectRuntimeTask({...base,leaseExpiresAt:'2000-01-01T00:00:00Z'});expect(projection.state).toBe('RUNNING');expect(projection.attemptCount).toBe(2);expect(projection.nextRetryAt).toBeNull();});
 it('projects offline devices and external service waits',()=>{expect(projectRuntimeTask({...base,runtimeKind:'DEVICE_TASK',status:'QUEUED',targetOnline:false}).state).toBe('WAITING_DEVICE');expect(projectRuntimeTask({...base,runtimeKind:'SERVICE_REQUEST',status:'BOOKED'}).state).toBe('WAITING_EXTERNAL');});
 it('fails closed on unknown states and invalid attempts',()=>{expect(projectRuntimeTask({...base,status:'executor_claimed_success'}).state).toBe('OUTCOME_UNKNOWN');expect(()=>projectRuntimeTask({...base,attemptCount:-1})).toThrow();});
});
