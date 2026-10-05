import {describe,it,expect} from 'vitest';
import {assessAcquisition,type AcquisitionEvidence} from '../src/acquisition';
import {assessState,nextBestAction,authorityNextBestAction,type AssessmentInput} from '../src/state-assessment';
import {buildLifecycleReadProjection,type LifecycleReadObservation} from '../src/lifecycle-read-projection';
const now='2026-10-04T00:00:00Z';
const evidence:AcquisitionEvidence={sourceId:'device:one:calendar',factKey:'calendar.event',authorized:true,online:true,available:true,conflict:false,readSucceeded:true,verified:true,itemCount:0,observedAt:now,maximumAgeSeconds:60,evidenceRefs:['signed-readback:one']};
describe('acquisition coverage and next action',()=>{
 it('requires verification evidence before projecting execution completion',()=>{
  const input:AssessmentInput={coverage:[assessAcquisition(evidence,now)],verifiedComplete:false,hasConflict:false,approvalRequired:false,approvalGranted:false,executionAuthorized:false,due:false,thresholdExceeded:null,changed:null,serviceAvailable:false};
  const authority=(status:string,steps:LifecycleReadObservation[])=>({executionId:'existing-execution',executionStatus:status,lifecycle:buildLifecycleReadProjection(steps)});
  expect(authorityNextBestAction(input,authority('succeeded',[]))).toBe('RECONCILE');
  const verified=authority('succeeded',[{key:'RESULT',state:'SUCCEEDED'},{key:'VERIFICATION',state:'SUCCEEDED'}]);
  expect(authorityNextBestAction(input,verified)).toBe('COMPLETE');
  expect(authorityNextBestAction(input,verified,true)).toBe('WAIT');
  expect(authorityNextBestAction(input,authority('running',[]))).toBe('WAIT');
  expect(authorityNextBestAction(input,authority('running',[{key:'APPROVAL',state:'RUNNING'}]))).toBe('REQUEST_APPROVAL');
  expect(authorityNextBestAction(input,authority('running',[{key:'RESULT',state:'OUTCOME_UNKNOWN'}]))).toBe('RECONCILE');
  expect(authorityNextBestAction(input,authority('queued',[{key:'RISK',state:'BLOCKED'}]))).toBe('ASK_USER');
 });
 it('only a successful evidenced read can mean verified empty',()=>{expect(assessAcquisition(evidence,now).state).toBe('VERIFIED_EMPTY');expect(assessAcquisition({...evidence,readSucceeded:false},now).state).toBe('UNAVAILABLE');expect(assessAcquisition({...evidence,evidenceRefs:[]},now).state).toBe('UNKNOWN');});
 it.each([['authorized',false,'PERMISSION_REQUIRED'],['online',false,'OFFLINE'],['conflict',true,'CONFLICT']] as const)('distinguishes %s', (key,value,state)=>{expect(assessAcquisition({...evidence,[key]:value},now).state).toBe(state);});
 it('does not refresh stale evidence by publishing it again',()=>{expect(assessAcquisition({...evidence,observedAt:'2026-10-03T00:00:00Z'},now).state).toBe('STALE');});
 it('cannot recommend execution from missing source or missing authorization',()=>{const input:AssessmentInput={coverage:[],verifiedComplete:false,hasConflict:false,approvalRequired:true,approvalGranted:false,executionAuthorized:false,due:true,thresholdExceeded:null,changed:null,serviceAvailable:false};expect(assessState(input).state).toBe('UNKNOWN');expect(nextBestAction(input)).toBe('ASK_USER');input.coverage=[assessAcquisition(evidence,now)];expect(nextBestAction(input)).toBe('REQUEST_APPROVAL');input.approvalGranted=true;expect(nextBestAction(input)).toBe('ASK_USER');input.executionAuthorized=true;expect(nextBestAction(input)).toBe('EXECUTE');});
});
