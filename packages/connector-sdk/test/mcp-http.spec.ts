import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpMcpTransport } from '../src/mcp';
afterEach(()=>vi.unstubAllGlobals());
describe('MCP HTTP protocol boundary',()=>{
 it('initializes a session and consumes structured results without trusting missing write annotations',async()=>{
  const methods:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
   const call=JSON.parse(String(init.body));methods.push(call.method);expect(init.redirect).toBe('error');
   if(call.method==='notifications/initialized')return new Response(null,{status:202});
   if(call.method!=='initialize')expect((init.headers as Record<string,string>)['Mcp-Session-Id']).toBe('test-session');
   const result=call.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{}}:call.method==='tools/list'?{tools:[{name:'write',inputSchema:{type:'object'},outputSchema:{type:'object'}}]}:{structuredContent:{operationId:'real-provider-id'},content:[{type:'text',text:'ignored presentation'}]};
   return new Response(JSON.stringify({jsonrpc:'2.0',id:call.id,result}),{headers:{'content-type':'application/json','mcp-session-id':'test-session'}});
  }));
  const transport=new HttpMcpTransport('pinned','https://mcp.example.com/api');
  expect((await transport.discover())[0].effectClass).toBe('EXTERNAL_SIDE_EFFECT');
  expect(await transport.invoke('write',{},{})).toEqual({operationId:'real-provider-id'});
  expect(methods).toEqual(['initialize','notifications/initialized','tools/list','tools/call']);
 });
 it('rejects oversized streamed responses before parsing',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(1000001),{headers:{'content-type':'application/json'}})));
  await expect(new HttpMcpTransport('pinned','https://mcp.example.com/api').discover()).rejects.toThrow('exceeds limit');
 });
 it('rejects mismatched JSON-RPC identities',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({id:'another-call',result:{}}))));
  await expect(new HttpMcpTransport('pinned','https://mcp.example.com/api').discover()).rejects.toThrow('identity mismatch');
 });
});
