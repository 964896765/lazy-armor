import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
const storage=vi.hoisted(()=>({isAvailableAsync:vi.fn(),getItemAsync:vi.fn(),setItemAsync:vi.fn(),WHEN_UNLOCKED_THIS_DEVICE_ONLY:6}));
vi.mock('expo-secure-store',()=>storage);
describe('native SMS caller hints',()=>{
 beforeEach(()=>{vi.resetModules();vi.clearAllMocks();storage.isAvailableAsync.mockResolvedValue(true);storage.setItemAsync.mockResolvedValue(undefined);storage.getItemAsync.mockResolvedValue(null);});
 afterEach(()=>vi.useRealTimers());
 it('reuses one installation marker across simultaneous calls and account changes',async()=>{storage.getItemAsync.mockResolvedValue(JSON.stringify({id:'client-existing-fixture',createdAt:Date.now()}));const {authClientMarker}=await import('./auth-client-marker.native');expect(await Promise.all([authClientMarker(),authClientMarker()])).toEqual(['client-existing-fixture','client-existing-fixture']);expect(storage.getItemAsync).toHaveBeenCalledTimes(1);expect(storage.setItemAsync).not.toHaveBeenCalled();});
 it('replaces an expired marker without using an account identifier or refresh token',async()=>{storage.getItemAsync.mockResolvedValue(JSON.stringify({id:'client-expired-fixture',createdAt:Date.now()-31*86400000}));const {authClientMarker}=await import('./auth-client-marker.native');const id=await authClientMarker();expect(id).toMatch(/^[-A-Za-z0-9_]{8,128}$/);expect(id).not.toBe('client-expired-fixture');expect(storage.setItemAsync).toHaveBeenCalledTimes(1);});
 it('uses a stable memory hint when native storage is unavailable',async()=>{storage.isAvailableAsync.mockResolvedValue(false);const {authClientMarker}=await import('./auth-client-marker.native');expect(await authClientMarker()).toBe(await authClientMarker());expect(storage.getItemAsync).not.toHaveBeenCalled();});
 it('bounds stalled native storage before preparing an auth request',async()=>{vi.useFakeTimers();storage.getItemAsync.mockReturnValue(new Promise(()=>{}));const {authClientMarker}=await import('./auth-client-marker.native');const pending=authClientMarker();await vi.advanceTimersByTimeAsync(1000);expect(await pending).toMatch(/^[-A-Za-z0-9_]{8,128}$/);});
});
