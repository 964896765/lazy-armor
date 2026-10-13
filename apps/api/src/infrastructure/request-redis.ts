import IORedis from 'ioredis';

// Request clients reject outages; worker queue connections keep their own policy.
export function createRequestRedis(url:string) {
  const client=new IORedis(url,{lazyConnect:true,maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:1000,commandTimeout:1000,retryStrategy:times=>Math.min(times*100,1000)});
  client.on('error',()=>{});
  return client;
}
export async function connectRequestRedis(client:IORedis) {
  if(client.status==='ready')return;
  const start=client.status==='wait'||client.status==='end';
  await new Promise<void>((resolve,reject)=>{
    const done=(error?:unknown)=>{clearTimeout(timer);client.off('ready',ready);client.off('error',failed);if(error)reject(new Error('Request Redis unavailable'));else resolve();};
    const ready=()=>done(),failed=()=>done(new Error('Request Redis unavailable'));
    const timer=setTimeout(failed,1000);
    client.once('ready',ready);client.once('error',failed);
    if(start)void client.connect().then(ready,failed);
    if(client.status==='ready')ready();
  });
}
