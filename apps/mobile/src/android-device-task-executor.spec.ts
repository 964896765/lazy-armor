import {describe,it,expect,vi,beforeEach} from 'vitest';
const mock=vi.hoisted(()=>({token:'session',read:vi.fn(),sync:vi.fn(),api:vi.fn(),structured:vi.fn()}));
vi.mock('react-native',()=>({Platform:{OS:'android'},NativeModules:{LazyArmorDeviceBridge:{acquireLocalResource:mock.read}}}));
vi.mock('./api',()=>({api:mock.api}));vi.mock('./auth-store',()=>({useAuthStore:{getState:()=>({token:mock.token})}}));
vi.mock('./local-capability-client',()=>({syncLocalCapabilities:mock.sync}));vi.mock('./android-structured-read-executor',()=>({executeStructuredRead:mock.structured}));
import {executeDeviceTask} from './android-device-task-executor';
import type {DeviceTask} from './device-task-client';
const task:DeviceTask={id:'task',trustedDeviceId:'trusted-device',deviceId:'phone',taskType:'NATIVE_CALENDAR_READ',factKey:'calendar_event.meetings.state',resourceType:'CalendarEvent',payload:{scopeStart:1000,scopeEnd:2000},status:'CLAIMED',claimToken:'claim',leaseExpiresAt:null,errorCode:null};
beforeEach(()=>{vi.clearAllMocks();mock.token='session';mock.api.mockResolvedValue({id:'user'});mock.sync.mockResolvedValue('user');});
describe('native dispatch on the existing DeviceTask runner',()=>{
 it('returns actual native receipt within the assigned scope',async()=>{const receipt={manifestVersion:'android-local-v1',capability:'calendar.read',state:'VERIFIED_EMPTY',items:[]};mock.read.mockResolvedValue(receipt);expect(await executeDeviceTask(task)).toBe(receipt);expect(mock.read).toHaveBeenCalledWith('user','calendar.read',1000,2000);});
 it('parses the native JSON receipt without replacing failed reads with empty data',async()=>{mock.read.mockResolvedValueOnce(JSON.stringify({manifestVersion:'android-local-v1',capability:'calendar.read',state:'UNAVAILABLE'}));expect(await executeDeviceTask(task)).toMatchObject({state:'UNAVAILABLE'});});
 it('does not invoke native read when manifest authorization sync fails',async()=>{mock.sync.mockRejectedValueOnce(new Error('grant rejected'));await expect(executeDeviceTask(task)).rejects.toThrow('grant rejected');expect(mock.read).not.toHaveBeenCalled();});
 it('does not continue native read across account changes',async()=>{mock.sync.mockImplementationOnce(async()=>{mock.token='different-account';});expect(await executeDeviceTask(task)).toBeNull();expect(mock.read).not.toHaveBeenCalled();});
 it('delegates structured reads to the existing executor',async()=>{const original={...task,taskType:'APP_STRUCTURED_READ'};await executeDeviceTask(original);expect(mock.structured).toHaveBeenCalledWith(original);expect(mock.read).not.toHaveBeenCalled();});
 it('rejects unbounded scopes without invoking the device',async()=>{expect(await executeDeviceTask({...task,payload:{scopeStart:0,scopeEnd:Infinity}})).toBeNull();expect(mock.read).not.toHaveBeenCalled();});
});
