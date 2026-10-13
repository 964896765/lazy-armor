import { createServer, createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { describe, expect, it } from 'vitest';
import { RateLimiterService } from '../src/infrastructure/rate-limiter.service';
describe('bounded request Redis under real socket faults',()=>{
  it.each(['warm','cold'])('rejects a %s connection blackhole without queuing the request for later execution',async phase=>{
    const target=new URL(process.env.REDIS_URL!);
    if(target.hostname!=='127.0.0.1'||!(target.port==='6391'||(process.env.CI==='true'&&target.port==='6379')))throw new Error('Isolated Redis6391 or CI6379 required');
    const prefix=process.env.REDIS_KEY_PREFIX!+':socket-fault:'+randomUUID();let blocked=phase==='cold';const sockets=new Set<Socket>();
    const proxy=createServer(client=>{
      const remote=createConnection({host:target.hostname,port:Number(target.port)});sockets.add(client);sockets.add(remote);
      client.on('data',data=>{if(!blocked)remote.write(data);});remote.on('data',data=>{if(!blocked)client.write(data);});
      client.on('error',()=>{});remote.on('error',()=>{});client.on('close',()=>remote.destroy());remote.on('close',()=>client.destroy());
    });
    await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));const url=new URL(target);url.port=String((proxy.address() as any).port);
    const limiter=new RateLimiterService({getOrThrow:()=>url.href,get:()=>prefix} as never),reader=new IORedis(target.href);
    try {
      if(phase==='warm')await limiter.consume('warmup',1,60);
      blocked=true;const start=performance.now();await expect(limiter.consume('blocked',1,60)).rejects.toMatchObject({status:503,response:{code:'RATE_LIMIT_SERVICE_UNAVAILABLE'}});
      expect(performance.now()-start).toBeLessThan(2500);expect(await reader.keys(prefix+':ratelimit:blocked:*')).toEqual([]);
      if(phase==='warm') {blocked=false;expect((await limiter.consume('recovered',1,60)).allowed).toBe(true);}
    } finally {await limiter.onApplicationShutdown();await reader.quit();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
  },10000);
});
