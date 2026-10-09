import {beforeEach,describe,expect,it,vi} from 'vitest';
const disk=vi.hoisted(()=>({files:new Map<string,string>(),rejectRename:false}));
vi.mock('expo-file-system/legacy',()=>({
 documentDirectory:'private/',makeDirectoryAsync:vi.fn(async()=>{}),
 readDirectoryAsync:vi.fn(async(root:string)=>[...disk.files.keys()].filter(k=>k.startsWith(root)).map(k=>k.slice(root.length))),
 readAsStringAsync:vi.fn(async(path:string)=>disk.files.get(path)!),
 writeAsStringAsync:vi.fn(async(path:string,data:string)=>{disk.files.set(path,data);}),
 moveAsync:vi.fn(async({from,to}:{from:string;to:string})=>{if(disk.rejectRename)throw new Error('rename failed');disk.files.set(to,disk.files.get(from)!);disk.files.delete(from);}),
 deleteAsync:vi.fn(async(path:string)=>{disk.files.delete(path);}),
}));
vi.mock('expo-secure-store',()=>({getItemAsync:vi.fn(async()=>null),deleteItemAsync:vi.fn(async()=>{})}));
vi.mock('./device-task-client',()=>({}));
import {secureRunnerStateStore,type RunnerState} from './device-task-runner';
const state:RunnerState={taskId:'task-storage',claimToken:'a'.repeat(64),leaseExpiresAt:new Date(Date.now()+60000).toISOString(),completedRead:{task:{id:'task-storage',trustedDeviceId:'trusted-1',deviceId:'device-1',taskType:'NATIVE_CALENDAR_READ',factKey:'calendar_event.meetings.state',resourceType:'CalendarEvent',payload:{},status:'CLAIMED',claimToken:'a'.repeat(64),leaseExpiresAt:new Date(Date.now()+60000).toISOString(),errorCode:null},result:{contentJson:'x'.repeat(50000)}}};
describe('private durable device result storage',()=>{
 beforeEach(()=>{disk.files.clear();disk.rejectRename=false;});
 it('retains a large result and commits logout as a tombstone',async()=>{
  await secureRunnerStateStore.save(state);expect(await secureRunnerStateStore.load()).toEqual(state);
  await secureRunnerStateStore.save(null);expect(await secureRunnerStateStore.load()).toBeNull();
 });
 it('ignores uncommitted partial writes and retains the previous receipt after rename failure',async()=>{
  await secureRunnerStateStore.save(state);disk.rejectRename=true;
  await expect(secureRunnerStateStore.save(null)).rejects.toThrow('rename failed');
  expect(await secureRunnerStateStore.load()).toEqual(state);
 });
 it('serializes receipt and logout writes so an old receipt cannot win a rename race',async()=>{
  await Promise.all([secureRunnerStateStore.save(state),secureRunnerStateStore.save(null)]);
  expect(await secureRunnerStateStore.load()).toBeNull();
 });
});
