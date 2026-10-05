import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { localCapabilityStates, trustedDevices,planCreationContracts,plans,planVersions } from '@lazy-armor/database';
import { LOCAL_CAPABILITY_CANONICAL_KEYS,localCapabilityGroup,localCapabilitySourceId, LOCAL_CAPABILITY_CATALOG, localCapabilityAvailability, type ResourceProjection } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import { isNull, and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import type { NativeCapabilitiesDto } from './local-capabilities.dto';
@Injectable()
export class LocalCapabilitiesService {
 constructor(@Inject(DATABASE) private readonly db:InjectedDatabase,private readonly audit:AuditService){}
 async receive(userId:string,deviceId:string,requestId:string,input:NativeCapabilitiesDto){
  const now=new Date();
  const expected=input.manifestVersion==='android-local-v2'&&input.capabilities.length===14?LOCAL_CAPABILITY_CATALOG.slice(0,14):LOCAL_CAPABILITY_CATALOG;
  if(input.capabilities.length!==expected.length||new Set(input.capabilities.map(row=>row.key)).size!==input.capabilities.length||expected.some(spec=>!input.capabilities.some(row=>row.key===spec.key)))throw new BadRequestException('本机能力清单不完整');
  if(input.capabilities.some(row=>row.checkedAt>now.getTime()+1000||now.getTime()-row.checkedAt>60000))throw new BadRequestException('本机能力证据已过期');
  await this.db.transaction(async tx=>{
   for(const row of input.capabilities){
    const spec=LOCAL_CAPABILITY_CATALOG.find(spec=>spec.key===row.key)!;
    const values={id:newId(),userId,trustedDeviceId:deviceId,capability:row.key,manifestVersion:input.manifestVersion,userGrant:row.userGrant,systemPermission:row.systemPermission,health:spec.implemented?row.health:'UNAVAILABLE',checkedAt:new Date(row.checkedAt),evidenceRef:`signed-request:${requestId}`,updatedAt:now};
    await tx.insert(localCapabilityStates).values(values).onDuplicateKeyUpdate({set:{userGrant:values.userGrant,systemPermission:values.systemPermission,health:values.health,checkedAt:values.checkedAt,evidenceRef:values.evidenceRef,updatedAt:now}});
   }
   await this.audit.append({actorType:'user',actorUserId:userId,userId,action:'LOCAL_CAPABILITY_MANIFEST_RECORDED',resourceType:'trusted_device',resourceId:deviceId,source:'api',result:'success',changeSummary:'Signed OS permission, user grant and capability health recorded',after:{manifestVersion:input.manifestVersion,evidenceRef:`signed-request:${requestId}`}},tx);
  });
  return {recorded:true};
 }
 async project(userId:string,currentDeviceId?:string):Promise<ResourceProjection[]>{
  const rows=await this.db.select({state:localCapabilityStates}).from(localCapabilityStates).innerJoin(trustedDevices,and(eq(trustedDevices.id,localCapabilityStates.trustedDeviceId),eq(trustedDevices.userId,localCapabilityStates.userId))).where(and(eq(localCapabilityStates.userId,userId),eq(trustedDevices.status,'active'),isNull(trustedDevices.revokedAt))).then(rows=>rows.map(row=>row.state));
  const bindings=await this.db.select({name:planVersions.name,planId:plans.id,sources:planCreationContracts.sourceSelectionJson}).from(planCreationContracts).innerJoin(plans,and(eq(plans.id,planCreationContracts.planId),eq(plans.activeVersionId,planCreationContracts.planVersionId))).innerJoin(planVersions,eq(planVersions.id,planCreationContracts.planVersionId)).where(eq(planCreationContracts.userId,userId));
  const labels:Record<string,string>={AVAILABLE:'已开启',NOT_IMPLEMENTED:'尚未接入',DISABLED:'未授权',PERMISSION_REQUIRED:'需要系统授权',UNAVAILABLE:'暂不可用',UNKNOWN:'待检查',PLATFORM_RESTRICTED:'平台限制',SPECIAL_PERMISSION:'特殊权限',UNSUPPORTED:'不支持'};
  return rows.map(row=>{
   const spec=LOCAL_CAPABILITY_CATALOG.find(spec=>spec.key===row.capability)!;
   const availability=localCapabilityAvailability({key:row.capability,userGrant:row.userGrant,systemPermission:row.systemPermission as never,health:row.health as never,checkedAt:row.checkedAt.getTime()},Date.now());
   return {resourceId:localCapabilitySourceId(row.trustedDeviceId,row.capability),kind:row.trustedDeviceId===currentDeviceId?'LOCAL':'DEVICE',name:spec.name,summary:availability==='NOT_IMPLEMENTED'?'尚未纳入统一授权与证据链':availability==='AVAILABLE'?'系统权限、用户授权与健康检查已确认':'用户授权与系统权限分别管理',status:row.systemPermission==='ON_DEMAND'&&row.userGrant?'每次选择授权':labels[availability],health:availability==='AVAILABLE'?'VERIFIED':'UNKNOWN',capabilities:availability==='AVAILABLE'?[row.capability]:[],reasons:availability==='AVAILABLE'?[]:[labels[availability]],lastVerifiedAt:row.checkedAt.toISOString(),sourceRef:{type:'LocalCapability',id:row.id},primaryAction:{label:'管理能力',path:'/resources'},capabilityState:{associatedPlans:bindings.filter(b=>b.sources.some(source=>source.sourceId===localCapabilitySourceId(row.trustedDeviceId,row.capability))).map(b=>({planId:b.planId,title:b.name})),canonicalKey:LOCAL_CAPABILITY_CANONICAL_KEYS[row.capability]??row.capability,group:localCapabilityGroup(row.capability),health:row.health,key:row.capability,userGrant:row.userGrant,systemPermission:row.systemPermission,availability,implemented:spec.implemented,readable:spec.readable},evidenceRefs:[row.evidenceRef],authority:'NATIVE_OS'};
  });
 }
}
