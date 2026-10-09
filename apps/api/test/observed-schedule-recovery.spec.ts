import {describe,it,expect} from 'vitest';
import {recoverObservedScheduleSlot} from '../src/strategy-runtime/terminal-handoff.service';

describe('observed scheduled occurrence recovery identity',()=>{
 const version='version',trigger='trigger',first='2026-10-07T16:03:00+08:00';
 const key='plan-wakeup:version:trigger:2026-10-07T08:03:00.000Z';
 const observed=new Date('2026-10-07T08:03:00.485Z');
 const recover=(id:string|null=key,time=observed,initial:unknown=first)=>recoverObservedScheduleSlot('3 16 * * *','Asia/Shanghai',time,id,version,trigger,initial);
 it('recovers the original observed slot, independent of later reconnect time',()=>{
  expect(recover()?.toISOString()).toBe('2026-10-07T08:03:00.000Z');
 });
 it.each([null,key.replace('version','other'),key.replace('trigger','other'),key.replace('08:03','08:04')])('rejects foreign version/trigger or invented occurrence %s',id=>{
  expect(recover(id)).toBeNull();
 });
 it('rejects a receipt outside the actual trigger minute',()=>{
  expect(recover(key,new Date('2026-10-07T08:04:01Z'))).toBeNull();
 });
 it('rejects an occurrence preceding the frozen firstRunAt',()=>{
  expect(recover(key,observed,'2026-10-08T16:03:00+08:00')).toBeNull();
 });
});
