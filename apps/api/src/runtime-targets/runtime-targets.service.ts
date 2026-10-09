import {AuditService} from '../audit/audit.service';
import {ConflictException,Inject,Injectable,NotFoundException} from '@nestjs/common';
import {runtimeTargets,trustedDevices,deviceHeartbeats,localCapabilityStates,connections,connectors,providerCapabilityManifests,serviceProviderProfiles,serviceOfferings,users,connectionCapabilityGrants,credentialRefs} from '@lazy-armor/database';
import {CAPABILITY_IDENTITY_REVISION,canonicalCapabilityId,canonicalStringify,runtimeTargetFreshness,assertRuntimeTargetEpoch,type RuntimeTarget} from '@lazy-armor/plan-schema';
import {newId} from '@lazy-armor/shared';
import {createHash} from 'node:crypto';
import {and,eq,desc} from 'drizzle-orm';
import {DATABASE,type InjectedDatabase} from '../common/database.module';
const hash=(value:unknown)=>createHash('sha256').update(canonicalStringify(value)).digest('hex');
interface Snapshot {targetType:RuntimeTarget['targetType'];backingRef:string;accountScope:string|null;authority:unknown;onlineState:RuntimeTarget['onlineState'];health:RuntimeTarget['health'];lastSeenAt:Date|null;manifest:unknown;metadata:Record<string,unknown>}
@Injectable()
export class RuntimeTargetsService {
 private readonly mcpBackings=new Map<string,()=>{serverId:string;transport:string;toolCatalogHash:string|null;healthy:boolean;lastSeenAt:string|null}>();
 registerMcpBacking(key:string,read:()=>{serverId:string;transport:string;toolCatalogHash:string|null;healthy:boolean;lastSeenAt:string|null}){this.mcpBackings.set(key,read);}
 constructor(@Inject(DATABASE) private readonly db:InjectedDatabase,private readonly audit:AuditService){}
 // Registration derives exclusively from existing owned backing state, never client-supplied grants.
 async refresh(userId:string){
  await this.db.transaction(async tx=>{
   const owner=(await tx.select().from(users).where(eq(users.id,userId)).for('update'))[0];if(!owner)throw new NotFoundException('Owner not found');
   const snapshots:Snapshot[]=[];const now=new Date();
   for(const d of await tx.select().from(trustedDevices).where(eq(trustedDevices.userId,userId)).for('update')){
    const heartbeat=(await tx.select().from(deviceHeartbeats).where(and(eq(deviceHeartbeats.userId,userId),eq(deviceHeartbeats.trustedDeviceId,d.id))))[0];
    const capabilities=await tx.select({capability:localCapabilityStates.capability,manifestVersion:localCapabilityStates.manifestVersion,userGrant:localCapabilityStates.userGrant}).from(localCapabilityStates).where(and(eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.trustedDeviceId,d.id))).orderBy(localCapabilityStates.capability).for('update');
    const online=runtimeTargetFreshness(heartbeat?.lastHeartbeatAt.toISOString()??null,now.toISOString(),30000);
    snapshots.push({targetType:'ANDROID_DEVICE',backingRef:d.id,accountScope:null,authority:{key:d.publicKeyFingerprint,status:d.status,ownerStatus:owner.status,grants:capabilities.map(c=>({capability:c.capability,userGrant:c.userGrant}))},onlineState:d.status==='active'?online:'OFFLINE',health:d.status!=='active'||owner.status!=='active'?'UNAVAILABLE':online==='ONLINE'?'HEALTHY':'UNKNOWN',lastSeenAt:heartbeat?.lastHeartbeatAt??null,manifest:{revision:'runtime-header-v1',identityRevision:CAPABILITY_IDENTITY_REVISION,capabilities:capabilities.map(c=>({...c,canonicalCapabilityId:canonicalCapabilityId(c.capability)}))},metadata:{backingType:'trusted_device',deviceId:d.deviceId}});
   }
   for(const {connection:c,connector} of await tx.select({connection:connections,connector:connectors}).from(connections).innerJoin(connectors,eq(connections.connectorId,connectors.id)).where(eq(connections.userId,userId)).for('update')){
    // Internal/device-app connectors are not official Provider targets.
    if((connector.providerType==='internal'||connector.providerType==='device_app')&&!this.mcpBackings.has(connector.key))continue;
    const manifest=(await tx.select().from(providerCapabilityManifests).where(eq(providerCapabilityManifests.providerKey,connector.key)).orderBy(desc(providerCapabilityManifests.revision)).limit(1))[0];
    const grants=await tx.select({capabilityKey:connectionCapabilityGrants.capabilityKey,status:connectionCapabilityGrants.status,updatedAt:connectionCapabilityGrants.updatedAt}).from(connectionCapabilityGrants).where(eq(connectionCapabilityGrants.connectionId,c.id)).orderBy(connectionCapabilityGrants.capabilityKey).for('update');
    const credential=c.credentialRefId?(await tx.select({version:credentialRefs.currentVersion,status:credentialRefs.status}).from(credentialRefs).where(eq(credentialRefs.id,c.credentialRefId)))[0]:null;
    const mcp=this.mcpBackings.get(connector.key)?.();
    const available=c.status==='connected'&&(!c.expiresAt||c.expiresAt>now)&&owner.status==='active';
    snapshots.push({targetType:mcp?'MCP_SERVER':'PROVIDER',backingRef:c.id,accountScope:c.id,authority:{status:c.status,credentialRef:c.credentialRefId,credential,expiresAt:c.expiresAt?.toISOString()??null,ownerStatus:owner.status,grants:grants.map(g=>({...g,updatedAt:g.updatedAt.toISOString()}))},onlineState:available?'UNKNOWN':'OFFLINE',health:available?'UNKNOWN':'UNAVAILABLE',lastSeenAt:c.lastCheckedAt,manifest:manifest?{revision:'runtime-header-v1',identityRevision:CAPABILITY_IDENTITY_REVISION,providerKey:connector.key,manifestHash:manifest.manifestHash}:{revision:'runtime-header-v1',identityRevision:CAPABILITY_IDENTITY_REVISION,providerKey:connector.key,manifest:null},metadata:{backingType:'connection',providerKey:connector.key,...(mcp?{serverId:mcp.serverId}: {})}});
   }
   for(const p of await tx.select().from(serviceProviderProfiles).where(eq(serviceProviderProfiles.userId,userId)).for('update')){
    const offerings=await tx.select({id:serviceOfferings.id,updatedAt:serviceOfferings.updatedAt}).from(serviceOfferings).where(and(eq(serviceOfferings.providerProfileId,p.id),eq(serviceOfferings.status,'PUBLISHED'))).orderBy(serviceOfferings.id);
    snapshots.push({targetType:'SERVICE_PROVIDER',backingRef:p.id,accountScope:null,authority:{status:p.status,updatedAt:p.updatedAt.toISOString(),ownerStatus:owner.status},onlineState:'UNKNOWN',health:p.status==='ACTIVE'&&owner.status==='active'?'UNKNOWN':'UNAVAILABLE',lastSeenAt:null,manifest:{revision:'runtime-header-v1',identityRevision:CAPABILITY_IDENTITY_REVISION,offerings:offerings.map(o=>({...o,updatedAt:o.updatedAt.toISOString()}))},metadata:{backingType:'service_provider_profile'}});
   }
   const existing=await tx.select().from(runtimeTargets).where(eq(runtimeTargets.userId,userId));
   for(const row of existing)if(!snapshots.some(s=>s.targetType===row.targetType&&s.backingRef===row.backingRef)&&row.health!=='UNAVAILABLE')await tx.update(runtimeTargets).set({health:'UNAVAILABLE',onlineState:'OFFLINE',authorityEpoch:row.authorityEpoch+1,authorityHash:hash({missing:true}),updatedAt:now}).where(eq(runtimeTargets.id,row.id));
   for(const s of snapshots){
    const prior=(await tx.select().from(runtimeTargets).where(and(eq(runtimeTargets.userId,userId),eq(runtimeTargets.targetType,s.targetType),eq(runtimeTargets.backingRef,s.backingRef))).for('update'))[0];
    const authorityHash=hash(s.authority),manifestHash=hash(s.manifest);const fields={accountScope:s.accountScope,authorityHash,authorityEpoch:prior?prior.authorityEpoch+(prior.authorityHash!==authorityHash?1:0):1,onlineState:s.onlineState,health:s.health,lastSeenAt:s.lastSeenAt,manifestVersion:'runtime-header-v1',manifestHash,metadata:s.metadata};
    const targetId=prior?.id??newId();
    if(prior)await tx.update(runtimeTargets).set({...fields,updatedAt:now}).where(eq(runtimeTargets.id,prior.id));else await tx.insert(runtimeTargets).values({...fields,id:targetId,userId,targetType:s.targetType,backingRef:s.backingRef,createdAt:now,updatedAt:now});
    if(!prior||prior.authorityEpoch!==fields.authorityEpoch||prior.manifestHash!==manifestHash||prior.health!==s.health||prior.onlineState!==s.onlineState)await this.audit.append({actorType:'system',userId,action:'RUNTIME_TARGET_REFRESHED',resourceType:'runtime_target',resourceId:targetId,source:'system',result:s.health==='UNAVAILABLE'?'blocked':'success',after:{targetType:s.targetType,backingRef:s.backingRef,authorityEpoch:fields.authorityEpoch,manifestHash,onlineState:s.onlineState,health:s.health},changeSummary:'Derived public runtime header from existing backing authority; no credential or grant copied'},tx);
   }
  });
  return (await this.db.select().from(runtimeTargets).where(eq(runtimeTargets.userId,userId))).map(row=>this.response(row));
 }
 async get(userId:string,id:string){await this.refresh(userId);const row=(await this.db.select().from(runtimeTargets).where(and(eq(runtimeTargets.userId,userId),eq(runtimeTargets.id,id))))[0];if(!row)throw new NotFoundException('Runtime target not found');return this.response(row);}
 async assertCurrent(userId:string,id:string,epoch:number,manifestHash?:string){const target=await this.get(userId,id);try{assertRuntimeTargetEpoch(target,epoch);}catch(e){throw new ConflictException((e as Error).message);}if(manifestHash!==undefined&&target.manifestHash!==manifestHash)throw new ConflictException('MANIFEST_HASH_MISMATCH');return target;}
 private response(row:typeof runtimeTargets.$inferSelect):RuntimeTarget{return {targetId:row.id,targetType:row.targetType as RuntimeTarget['targetType'],ownerScope:row.userId,accountScope:row.accountScope,authorityEpoch:row.authorityEpoch,onlineState:row.onlineState as RuntimeTarget['onlineState'],health:row.health as RuntimeTarget['health'],lastSeenAt:row.lastSeenAt?.toISOString()??null,manifestVersion:row.manifestVersion,manifestHash:row.manifestHash,metadata:{...row.metadata,backingRef:row.backingRef}};}
}
