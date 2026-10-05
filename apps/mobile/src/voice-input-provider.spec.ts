import { describe, it, expect, vi, afterEach } from 'vitest';
import { VoiceInputController, type VoiceInputSnapshot } from './voice-input-provider';
describe('editable voice input boundary',()=>{
 afterEach(()=>vi.useRealTimers());
 it('tracks listening and transcription and returns text without sending it',async()=>{
  const states:VoiceInputSnapshot[]=[];const controller=new VoiceInputController({start:async transcribing=>{transcribing();return ' 可编辑的需求 ';},cancel:async()=>{}},state=>states.push(state));
  expect(await controller.start()).toBe('可编辑的需求');expect(states.map(state=>state.state)).toEqual(['LISTENING','TRANSCRIBING','IDLE']);
 });
 it('ignores late recognition after cancellation',async()=>{
  let resolve!:(text:string)=>void;const states:VoiceInputSnapshot[]=[];const cancel=vi.fn().mockResolvedValue(undefined);
  const controller=new VoiceInputController({start:()=>new Promise(r=>resolve=r),cancel},state=>states.push(state));
  const result=controller.start();await controller.cancel();resolve('不应出现在输入框');expect(await result).toBeNull();expect(states.at(-1)?.state).toBe('IDLE');expect(cancel).toHaveBeenCalled();
 });
 it('times out and releases the native recognizer without accepting late text',async()=>{
  vi.useFakeTimers();let resolve!:(text:string)=>void;const states:VoiceInputSnapshot[]=[];const cancel=vi.fn().mockResolvedValue(undefined);
  const controller=new VoiceInputController({start:()=>new Promise(r=>resolve=r),cancel},state=>states.push(state),100);
  const result=controller.start();await vi.advanceTimersByTimeAsync(101);expect(states.at(-1)?.state).toBe('ERROR');resolve('过期文字');expect(await result).toBeNull();expect(cancel).toHaveBeenCalled();
 });
 it('preserves permission/recognition failures as an explicit error',async()=>{
  const states:VoiceInputSnapshot[]=[];const controller=new VoiceInputController({start:async()=>{throw new Error('需要麦克风权限');},cancel:async()=>{}},state=>states.push(state));
  expect(await controller.start()).toBeNull();expect(states.at(-1)).toEqual({state:'ERROR',error:'需要麦克风权限'});
 });
 it('blocks restart until native cancellation has finished',async()=>{
  let release!:()=>void;const start=vi.fn().mockImplementation(()=>new Promise(()=>{}));
  const controller=new VoiceInputController({start,cancel:()=>new Promise<void>(resolve=>release=resolve)},()=>{});
  void controller.start();const cancelling=controller.cancel();
  expect(await controller.start()).toBeNull();expect(start).toHaveBeenCalledTimes(1);
  release();await cancelling;void controller.start();expect(start).toHaveBeenCalledTimes(2);
  release=()=>{};
 });

});
