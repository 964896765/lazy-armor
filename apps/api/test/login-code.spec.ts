import {LocalLoginCodeDeliveryProvider} from '../src/auth/local-login-code-delivery.provider';
import { describe,it,expect,vi,afterEach } from 'vitest';
const redis=vi.hoisted(()=>({set:vi.fn(),del:vi.fn(),eval:vi.fn(),quit:vi.fn(),status:'ready'}));
vi.mock('ioredis',()=>({default:class{constructor(){return redis;}}}));
import { LoginCodeService } from '../src/auth/login-code.service';
function make(values:Record<string,string>={}){return new LoginCodeService({get:(key:string)=>values[key],getOrThrow:(key:string)=>values[key]??'private-test-secret'} as never,{consume:vi.fn().mockResolvedValue({allowed:true})} as never,new LocalLoginCodeDeliveryProvider({get:(key:string)=>values[key]} as never));}
describe('passwordless login boundary',()=>{
 afterEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();});
 it('uses console-only random delivery in development without a configured endpoint',async()=>{const log=vi.spyOn(console,'info').mockImplementation(()=>{});const s=make({NODE_ENV:'development',APP_ENV:'development'});const response=await s.request({kind:'email',identifier:'a@example.com'},'ip');expect(response).toMatchObject({sent:true,delivery:'LOCAL_DEVELOPMENT'});expect(response).not.toHaveProperty('code');const record=JSON.parse(log.mock.calls[0][1]);expect(record.code).toMatch(/^\d{6}$/);expect(record.account).not.toBe('a@example.com');expect(redis.set.mock.calls[0][1]).not.toBe(record.code);log.mockRestore();});
 it.each(['staging','production'])('never uses local delivery for %s',async env=>{const s=make({NODE_ENV:'development',APP_ENV:env});await expect(s.request({kind:'phone',identifier:'13800138000'},'ip')).rejects.toThrow('暂未开放');expect(redis.set).not.toHaveBeenCalled();});
 it.each(['staging','production','test'])('rejects local delivery when NODE_ENV is %s even if APP_ENV says development',async env=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  try{await expect(make({NODE_ENV:env,APP_ENV:'development'}).request({kind:'email',identifier:'a@example.com'},'ip')).rejects.toThrow('暂未开放');expect(log).not.toHaveBeenCalled();expect(redis.set).not.toHaveBeenCalled();}finally{log.mockRestore();}
 });
 it('does not fall back to console delivery when a configured gateway fails in development',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false}));
  try{await expect(make({NODE_ENV:'development',EMAIL_LOGIN_DELIVERY_ENDPOINT:'https://example.com',LOGIN_CODE_DELIVERY_TOKEN:'secret'}).request({kind:'email',identifier:'a@example.com'},'ip')).rejects.toThrow('未能发送');expect(log).not.toHaveBeenCalled();expect(redis.del).toHaveBeenCalled();}finally{log.mockRestore();}
 });
 it('enforces the send frequency limit before issuing or logging a code',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  const s=new LoginCodeService({get:(key:string)=>key==='NODE_ENV'?'development':undefined,getOrThrow:()=> 'private-test-secret'} as never,{consume:vi.fn().mockResolvedValue({allowed:false})} as never,new LocalLoginCodeDeliveryProvider({get:(key:string)=>key==='NODE_ENV'?'development':undefined} as never));
  try{await expect(s.request({kind:'phone',identifier:'13800138000'},'ip')).rejects.toThrow('稍后');expect(redis.set).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();}finally{log.mockRestore();}
 });
 it('uses the same expiring hashed storage for local phone codes',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  try{const before=Date.now();const response=await make({NODE_ENV:'development'}).request({kind:'phone',identifier:'13800138000'},'ip');const record=JSON.parse(log.mock.calls[0][1]);expect(record.channel).toBe('phone');expect(record.account).not.toContain('13800138000');expect(Date.parse(record.expiresAt)-before).toBeGreaterThanOrEqual(300000);expect(redis.set.mock.calls[0].slice(2)).toEqual(['EX',300]);expect(JSON.stringify(response)).not.toContain(record.code);}finally{log.mockRestore();}
 });
 it('normalizes phone and email without accepting malformed identifiers',()=>{const s=make();expect(s.normalize({kind:'phone',identifier:'13800138000'})).toBe('+8613800138000');expect(s.normalize({kind:'email',identifier:' A@Example.com '})).toBe('a@example.com');expect(()=>s.normalize({kind:'phone',identifier:'123'})).toThrow();});
 it('fails closed without a real secure delivery provider and never issues a code',async()=>{const s=make();await expect(s.request({kind:'email',identifier:'a@example.com'},'ip')).rejects.toThrow('暂未开放');expect(redis.set).not.toHaveBeenCalled();});
 it('rejects an HTTP gateway',async()=>{const s=make({EMAIL_LOGIN_DELIVERY_ENDPOINT:'http://example.com',LOGIN_CODE_DELIVERY_TOKEN:'secret'});await expect(s.request({kind:'email',identifier:'a@example.com'},'ip')).rejects.toThrow('暂未开放');expect(redis.set).not.toHaveBeenCalled();});
 it('stores only a digest, never returns the code and invalidates failed delivery',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false}));const s=make({EMAIL_LOGIN_DELIVERY_ENDPOINT:'https://example.com',LOGIN_CODE_DELIVERY_TOKEN:'secret'});await expect(s.request({kind:'email',identifier:'a@example.com'},'ip')).rejects.toThrow('未能发送');expect(redis.set.mock.calls[0][1]).toMatch(/^[a-f0-9]{64}$/);expect(redis.del).toHaveBeenCalled();});
 it('atomically accepts a valid code once; expired or consumed codes cannot log in',async()=>{const s=make();redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);const input={kind:'email' as const,identifier:'a@example.com',code:'123456'};await expect(s.verify(input,'ip')).resolves.toBe('a@example.com');await expect(s.verify(input,'ip')).rejects.toThrow('不正确或已过期');expect(redis.eval.mock.calls[0][0]).toContain("redis.call('DEL'");});
});
