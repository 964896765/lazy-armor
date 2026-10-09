import {createHash} from 'node:crypto';
import {RuntimeTargetsService} from '../runtime-targets/runtime-targets.service';
import { ConflictException, Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConnectorError, ConnectorRegistry, HttpMcpTransport, candidateCapability, type McpTransport, type ConnectorRequest, type ProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import { canonicalStringify } from '@lazy-armor/plan-schema';
import { connections, credentialRefs, sideEffectOperations, executions,capabilityIdentities,capabilityAliases } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../credentials/credential-provider';
import { ConnectorCatalogSyncService } from '../connectors/connector-catalog-sync.service';
import { ProviderCapabilityRegistryService } from '../provider-capabilities/provider-capability-registry.service';
import { ResolutionEvidenceService } from '../capability-resolver/resolution-evidence.service';
import { VerificationPolicyRegistry } from '../execution/verification-policy-registry.service';
import { McpServerRegistryService } from './mcp-server-registry.service';
import { McpBoundConnector, type McpExecutionBinding } from './mcp-bound.connector';

const path = z.array(z.string().min(1).max(80).refine(value=>!['__proto__','prototype','constructor'].includes(value))).min(1).max(8);
const bindingSchema = z.object({serverId:z.string().regex(/^[a-z0-9_-]{1,40}$/),connectorKey:z.string().regex(/^mcp_[a-z0-9_-]{1,70}$/),toolName:z.string().min(1).max(80),readBackToolName:z.string().min(1).max(80),resource:z.string().min(1).max(100),costMicros:z.number().int().nonnegative(),schemaHash:z.string().regex(/^[a-f0-9]{64}$/),readBackSchemaHash:z.string().regex(/^[a-f0-9]{64}$/),resultIdField:z.string().min(1).max(80),lookupIdField:z.string().min(1).max(80),comparisons:z.array(z.object({readBackPath:path,argumentPath:path}).strict()).min(1).max(20),supportsIdempotency:z.boolean(),idempotencyField:z.string().min(1).max(80).optional(),authentication:z.enum(['none','api_key']),revision:z.number().int().positive()}).strict();

/** Installs an operator-pinned provider adapter into existing registries. No execution endpoint. */
@Injectable()
export class McpExecutionRegistrationService implements OnApplicationBootstrap {
 constructor(private readonly targets:RuntimeTargetsService,private readonly servers:McpServerRegistryService,private readonly connectors:ConnectorRegistry,private readonly catalog:ConnectorCatalogSyncService,private readonly manifests:ProviderCapabilityRegistryService,private readonly verification:VerificationPolicyRegistry,private readonly evidence:ResolutionEvidenceService,@Inject(DATABASE) private readonly db:InjectedDatabase,@Inject(CREDENTIAL_PROVIDER) private readonly credentials:CredentialProvider) {}
 async onApplicationBootstrap() {
  if(!process.env.MCP_EXECUTION_BINDINGS_JSON) return;
  const settings=z.array(z.object({endpoint:z.string().url(),binding:bindingSchema}).strict()).max(20).parse(JSON.parse(process.env.MCP_EXECUTION_BINDINGS_JSON));
  for(const item of settings) {
   const endpoint=new URL(item.endpoint);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash) throw new Error('Configured MCP execution endpoint must use HTTPS without embedded credentials');
   this.servers.registerServer({serverId:item.binding.serverId,displayName:item.binding.serverId,transport:'HTTP',serverVersion:'configured',toolCatalogHash:null,trustState:'ALLOWLISTED',authorized:false,healthy:false,lastSeenAt:null,endpoint:item.endpoint},new HttpMcpTransport(item.binding.serverId,item.endpoint));
   await this.install(item.binding);
  }
 }
 async install(raw:McpExecutionBinding, testTransport?:McpTransport) {
  const binding=bindingSchema.parse(raw);
  if(testTransport && process.env.NODE_ENV!=='test') throw new ConflictException('Test transports are disabled outside explicit tests');
  await this.servers.discover(binding.serverId);
  const write=await this.servers.bindTool(binding.serverId,binding.toolName);const read=await this.servers.bindTool(binding.serverId,binding.readBackToolName);
  if(write.schemaHash!==binding.schemaHash||read.schemaHash!==binding.readBackSchemaHash||write.effectClass!=='EXTERNAL_SIDE_EFFECT'||read.effectClass!=='READ_ONLY') throw new ConflictException('Operator pin does not match MCP schemas/effect classes');
  if(binding.supportsIdempotency && (!binding.idempotencyField||!(this.servers.getTool(binding.serverId,binding.toolName).inputSchema.properties as Record<string,unknown>|undefined)?.[binding.idempotencyField])) throw new ConflictException('Idempotency must be an explicit input-schema field');
  const transport=async(request:ConnectorRequest)=> {
   if(testTransport) return testTransport;
   const descriptor=this.servers.listServers().find(server=>server.serverId===binding.serverId);if(!descriptor?.endpoint?.startsWith('https://')) throw new ConnectorError('MCP_ENDPOINT_UNAVAILABLE','PROVIDER_UNAVAILABLE','No allowed HTTPS MCP endpoint');
   let headers:Record<string,string>|undefined;
   if(binding.authentication==='api_key') { if(!request.credentials?.ref) throw new ConnectorError('AUTH_REQUIRED','AUTH_REQUIRED','MCP credential required');const credential=await this.credentials.get(request.credentials.ref,request.credentials.version);if(!credential.apiKey) throw new ConnectorError('AUTH_REQUIRED','AUTH_REQUIRED','MCP credential unavailable');headers={authorization:`Bearer ${credential.apiKey}`}; }
   return new HttpMcpTransport(binding.serverId,descriptor.endpoint,{headers});
  };
  // Explicit operator binding receives a stable server/tool identity; no inference from display names.
  const canonicalId='mcp.tool.'+createHash('sha256').update(canonicalStringify({serverId:binding.serverId,toolName:binding.toolName})).digest('hex');
  await this.db.transaction(async tx=>{await tx.insert(capabilityIdentities).values({id:canonicalId,revision:'canonical-capability-v1'}).onDuplicateKeyUpdate({set:{revision:'canonical-capability-v1'}});const prior=(await tx.select().from(capabilityAliases).where(eq(capabilityAliases.alias,write.capabilityKey)))[0];if(prior&&prior.canonicalId!==canonicalId)throw new ConflictException('MCP canonical alias collision');if(!prior)await tx.insert(capabilityAliases).values({alias:write.capabilityKey,canonicalId,revision:'canonical-capability-v1'});});
  const connector=new McpBoundConnector(binding,this.servers,transport,async request=> {
   if(!request.executionOperationId||!request.userId||!request.connectionId) throw new ConnectorError('CANONICAL_OPERATION_REQUIRED','PERMISSION_DENIED','MCP writes require a canonical outbox operation');
   const row=(await this.db.select({operation:sideEffectOperations,execution:executions}).from(sideEffectOperations).innerJoin(executions,eq(sideEffectOperations.executionId,executions.id)).where(and(eq(sideEffectOperations.id,request.executionOperationId),eq(sideEffectOperations.userId,request.userId))).limit(1))[0];
   if(!row||row.operation.status!=='executing'||row.operation.connectionId!==request.connectionId||row.operation.capabilityKey!==request.capability||row.execution.approvalStatus!=='approved') throw new ConnectorError('CANONICAL_OPERATION_REQUIRED','PERMISSION_DENIED','MCP write has no approved current operation');
   const context=request.input.context;if(canonicalStringify(context)!==canonicalStringify(row.execution.triggerPayloadJson)) throw new ConnectorError('FROZEN_INPUT_MISMATCH','PERMISSION_DENIED','MCP input differs from approved execution');
  });
  this.connectors.register(connector);
  const capability={...candidateCapability({key:write.capabilityKey,name:binding.toolName,resource:binding.resource,riskLevel:'R3',operation:'execute',sourceModes:['OFFICIAL_API']}),officialAvailability:'AVAILABLE' as const,implementationStatus:'PRODUCTION' as const,reviewStatus:'VERIFIED' as const,providerAvailability:'beta' as const,accountTypes:['mcp_connection'],actionModes:['EXECUTE' as const],realtimeModes:['NONE' as const],verificationMethods:['OPERATION_LOOKUP'],sideEffectContract:connector.capabilities()[0]!.sideEffectContract!,dataBoundary:{resources:[binding.resource],readableFields:[],writableFields:[],purpose:['USER_CONFIRMED_ONE_TIME_RUN','CONFIRMED_ACTION_PROPOSAL'],sensitiveFields:[]},evidence:[{kind:'MANUAL_REVIEW' as const,status:'VERIFIED' as const,summary:'Operator-pinned schema, effect class and independent read-back comparisons'}]};
  const manifest:ProviderCapabilityManifest={schemaVersion:'1',providerKey:binding.connectorKey,providerName:binding.toolName,revision:binding.revision,accountTypes:['mcp_connection'],sourceModes:['OFFICIAL_API'],actionModes:['EXECUTE'],providerReview:'VERIFIED',rateLimitPolicy:'bounded-mcp-call',capabilities:[capability],evidence:capability.evidence,explicitDenials:[]};
  this.manifests.installRevision(manifest);await this.manifests.sync();await this.catalog.sync();
  this.verification.register({key:`mcp-read-back/${binding.connectorKey}`,revision:String(binding.revision),providerKey:binding.connectorKey,capabilityKey:write.capabilityKey,methods:['OPERATION_LOOKUP','PROVIDER_RESPONSE','USER_CONFIRMATION'],timeoutMs:10000,maxAttempts:3,expiresAfterMs:3600000,predicates:[{path:['mcpReadBackMatched'],equals:true,result:'SUCCEEDED'}]});
  this.evidence.register(binding.connectorKey,async context=> {
   const connection=(await this.db.select().from(connections).where(and(eq(connections.id,context.connectionId),eq(connections.userId,context.userId))).limit(1))[0];if(!connection) throw new Error('Owned connection required');
   const ref=connection.credentialRefId ? (await this.db.select().from(credentialRefs).where(eq(credentialRefs.id,connection.credentialRefId)).limit(1))[0] : null;
   const started=Date.now();const health=await connector.validateConnection({capability:write.capabilityKey,input:{},requestId:`resolve:${context.planVersionId}`,userId:context.userId,connectionId:context.connectionId,credentials:{ref:ref?.ref ?? undefined,version:ref?.currentVersion ?? undefined}});
   return {accountSatisfied:true,deviceSatisfied:true,reality:'VERIFIED',observedAt:health.checkedAt,costMicros:binding.costMicros,latencyMs:Date.now()-started,reliability:null};
  });
  this.targets.registerMcpBacking(binding.connectorKey,()=>{const descriptor=this.servers.listServers().find(s=>s.serverId===binding.serverId);if(!descriptor)throw new ConflictException('MCP backing registration missing');return descriptor;});
  return {providerKey:binding.connectorKey,capabilityKey:write.capabilityKey,schemaHash:binding.schemaHash};
 }
}

