import { ConnectorError, McpClient, type Connector, type ConnectorMetadata, type ConnectorRequest, type McpToolDescriptor, type McpTransport } from '@lazy-armor/connector-sdk';
import { canonicalStringify } from '@lazy-armor/plan-schema';
import type { McpServerRegistryService } from './mcp-server-registry.service';

export interface McpExecutionBinding {
 serverId: string; connectorKey: string; toolName: string; readBackToolName: string;
 resource: string; schemaHash: string; readBackSchemaHash: string; costMicros: number;
 resultIdField: string; lookupIdField: string;
 comparisons: Array<{ readBackPath: string[]; argumentPath: string[] }>;
 supportsIdempotency: boolean; idempotencyField?: string; authentication: 'none' | 'api_key'; revision: number;
}
function field(value: unknown, path: string[]) { for (const key of path) { if (!key || ['__proto__','constructor','prototype'].includes(key) || value === null || typeof value !== 'object' || !Object.hasOwn(value,key)) return undefined; value=(value as Record<string,unknown>)[key]; } return value; }
/** A provider adapter only. It is dispatched exclusively by the existing outbox. */
export class McpBoundConnector implements Connector {
 constructor(readonly binding: McpExecutionBinding, private readonly servers: McpServerRegistryService, private readonly transport: (request: ConnectorRequest) => Promise<McpTransport>, private readonly authorize: (request: ConnectorRequest) => Promise<void>) {}
 metadata(): ConnectorMetadata { return { key:this.binding.connectorKey,name:`MCP · ${this.binding.toolName}`,description:'经现有执行链调用、独立读回验证的 MCP 能力',version:`1.0.${this.binding.revision}`,connectorSdkVersion:'0.1.0',providerType:'internal',productionStatus:'BETA',authentication:{type:this.binding.authentication},supportsRefresh:false,supportsRevoke:false,supportsWebhook:false,supportsHealthCheck:true,sandboxSupport:'none',rateLimitStrategy:'unknown' }; }
 capabilities() { return [{key:this.servers.requireBinding(this.binding.serverId,this.binding.toolName).capabilityKey,name:this.binding.toolName,riskLevel:'R3' as const,operation:'execute' as const,requiredPermission:this.servers.getTool(this.binding.serverId,this.binding.toolName).capabilityKey,providerAvailability:'beta' as const,sideEffectContract:{sideEffect:true,supportsIdempotencyKey:this.binding.supportsIdempotency,supportsOperationLookup:true,retrySafety:this.binding.supportsIdempotency ? 'safe' as const : 'unsafe' as const,idempotencyKeyMaxLength:128,idempotencySemantics:'body' as const}}]; }
 private async client(request:ConnectorRequest,sideEffect:boolean) {
  const write=this.servers.requireBinding(this.binding.serverId,this.binding.toolName);const read=this.servers.requireBinding(this.binding.serverId,this.binding.readBackToolName);
  if(write.schemaHash!==this.binding.schemaHash||read.schemaHash!==this.binding.readBackSchemaHash) throw new ConnectorError('MCP_SCHEMA_CHANGED','PERMISSION_DENIED','MCP schemas changed after operator binding');
  const client=new McpClient({allowedServers:[this.binding.serverId],allowedTools:[this.binding.toolName,this.binding.readBackToolName],allowSideEffect:sideEffect,timeoutMs:5000,maxResponseBytes:1000000},new Map([[this.binding.serverId,await this.transport(request)]]));
  await client.discover(this.binding.serverId);
  const current=client.listTools(this.binding.serverId);
  const bound=(name:string,hash:string,effect:string)=>current.some(tool=>tool.toolName===name&&tool.schemaHash===hash&&tool.effectClass===effect);
  if(!bound(this.binding.toolName,this.binding.schemaHash,'EXTERNAL_SIDE_EFFECT')||!bound(this.binding.readBackToolName,this.binding.readBackSchemaHash,'READ_ONLY')) throw new ConnectorError('MCP_SCHEMA_CHANGED','PERMISSION_DENIED','MCP schema or effect class no longer matches frozen binding');
  return client;
 }
 async validateConnection(request?:ConnectorRequest) { if(!request) throw new ConnectorError('AUTH_REQUIRED','AUTH_REQUIRED','Connection context required');await this.client(request,false);return {status:'healthy' as const,checkedAt:new Date().toISOString(),validUntil:new Date(Date.now()+300000).toISOString()}; }
 async execute(request:ConnectorRequest) {
  await this.authorize(request);
  const client=await this.client(request,true);
  const context=request.input.context as Record<string,unknown>|undefined;const argumentsValue=context?.arguments;
  if(!argumentsValue||typeof argumentsValue!=='object'||Array.isArray(argumentsValue)) throw new ConnectorError('INVALID_INPUT','INVALID_REQUEST','MCP arguments must come from the frozen execution input');
  const args={...(argumentsValue as Record<string,unknown>)};
  if(this.binding.supportsIdempotency) { if(!request.providerIdempotencyKey||!this.binding.idempotencyField) throw new ConnectorError('IDEMPOTENCY_REQUIRED','INVALID_REQUEST','Provider idempotency contract required'); args[this.binding.idempotencyField]=request.providerIdempotencyKey; }
  let response;
  try { response=await client.invokeTool({serverId:this.binding.serverId,toolName:this.binding.toolName,arguments:args,requestId:request.requestId,userId:request.userId},this.binding.schemaHash,'EXTERNAL_SIDE_EFFECT'); }
  catch { throw new ConnectorError('MCP_WRITE_OUTCOME_UNKNOWN','OUTCOME_UNKNOWN','MCP write may have taken effect; read-back is required',{operationState:'unknown'}); }
  if(!response.ok||!response.content) throw new ConnectorError('MCP_WRITE_OUTCOME_UNKNOWN','OUTCOME_UNKNOWN','MCP write returned no conclusive effect evidence',{operationState:'unknown'});
  const operationId=response.content[this.binding.resultIdField];
  if(typeof operationId!=='string'||!operationId||operationId.length>255) throw new ConnectorError('MCP_WRITE_OUTCOME_UNKNOWN','OUTCOME_UNKNOWN','MCP write has no usable operation identity',{operationState:'unknown'});
  try { return await this.readBack(client,request,operationId,args); }
  catch { throw new ConnectorError('MCP_READ_BACK_UNKNOWN','OUTCOME_UNKNOWN','MCP effect cannot yet be verified',{operationState:'unknown',providerOperationId:operationId}); }
 }
 private async readBack(client:McpClient,request:ConnectorRequest,operationId:string,args:Record<string,unknown>) {
  const read=await client.invokeTool({serverId:this.binding.serverId,toolName:this.binding.readBackToolName,arguments:{[this.binding.lookupIdField]:operationId},requestId:`${request.requestId}:read-back`,userId:request.userId},this.binding.readBackSchemaHash,'READ_ONLY');
  if(!read.ok||!read.content||read.content[this.binding.lookupIdField]!==operationId) throw new Error('Read-back operation identity mismatch');
  const matches=this.binding.comparisons.every(comparison=>{const expected=field(args,comparison.argumentPath),actual=field(read.content,comparison.readBackPath);return expected!==undefined&&actual!==undefined&&canonicalStringify(expected)===canonicalStringify(actual);});
  if(!matches) throw new Error('Read-back does not match the approved effect');
  return {ok:true,data:{operationId,mcpReadBackMatched:true,writeSchemaHash:this.binding.schemaHash,readBackSchemaHash:this.binding.readBackSchemaHash,readBackEvidenceHash:read.evidence.evidenceHash}};
 }
 async lookupOperation(request:ConnectorRequest) {
  const client=await this.client(request,false);const context=request.input.context as Record<string,unknown>|undefined;const args=context?.arguments;
  if(!request.operationId||!args||typeof args!=='object'||Array.isArray(args)) return {ok:true,data:{mcpReadBackMatched:false}};
  try{return await this.readBack(client,request,request.operationId,args as Record<string,unknown>);}catch{return {ok:true,data:{mcpReadBackMatched:false}};}
 }
}
