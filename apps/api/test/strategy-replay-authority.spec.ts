import { describe, expect, it } from 'vitest';
import { strategyProofWakeupId } from '../src/execution/execution-dispatch.service';
describe('Strategy replay authority',()=>{
 it('accepts both established handoff proof kinds',()=>{
  expect(strategyProofWakeupId({truthHandoffProof:{wakeupId:'truth-wakeup'}})).toBe('truth-wakeup');
  expect(strategyProofWakeupId({terminalHandoffProof:{wakeupId:'terminal-wakeup'}})).toBe('terminal-wakeup');
 });
 it('fails closed for missing and conflicting proof identities',()=>{
  expect(strategyProofWakeupId(null)).toBeUndefined();
  expect(strategyProofWakeupId({truthHandoffProof:{wakeupId:'a'},terminalHandoffProof:{wakeupId:'b'}})).toBeUndefined();
 });
});
