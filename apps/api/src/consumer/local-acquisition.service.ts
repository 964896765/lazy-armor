import {createHash} from 'node:crypto';
import {localCapabilitySourceId,canonicalStringify,localCapabilityAvailability} from '@lazy-armor/plan-schema';
import {RealityPipelineService,type RealityExecutor} from '../reality-pipeline/reality-pipeline.service';
import {BadRequestException,Inject,Injectable} from '@nestjs/common';
import {acquisitionRounds,localCapabilityStates,trustedDevices,artifacts} from '@lazy-armor/database';
import {artifactAcquisitionItemSchema,artifactReceiptMatchesCapability} from './artifact-acquisition-contract';
import {newId} from '@lazy-armor/shared';
import {and,desc,eq} from 'drizzle-orm';
import {DATABASE,type InjectedDatabase} from '../common/database.module';
import {AuditService} from '../audit/audit.service';
import type {LocalAcquisitionDto} from './local-acquisition.dto';
@Injectable()
export class LocalAcquisitionService {
 constructor(@Inject(DATABASE)private readonly db:InjectedDatabase,private readonly audit:AuditService,private readonly reality:RealityPipelineService){}
 async receive(userId:string,deviceId:string,requestId:string,input:LocalAcquisitionDto,parentTx?:RealityExecutor){
  const store=parentTx??this.db;
  const now=new Date();const observedAt=new Date(input.observedAt),start=new Date(input.scopeStart),end=new Date(input.scopeEnd);
  if(![observedAt,start,end].every(date=>Number.isFinite(date.getTime()))||start>=end||end.getTime()-start.getTime()>31*86400000||observedAt.getTime()>now.getTime()+5000)throw new BadRequestException('Invalid native acquisition scope');
  const grant=(await store.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.userId,userId),eq(localCapabilityStates.trustedDeviceId,deviceId),eq(localCapabilityStates.capability,input.capability))).limit(1))[0];
  if(!grant?.userGrant)throw new BadRequestException('请先开启此本机能力');
  let state=input.state;
  const artifactRead=['files.read','share.read'].includes(input.capability);
  const artifactRefs:string[]=[];
  if(artifactRead&&['VERIFIED_PRESENT','VERIFIED_EMPTY'].includes(state)){
   if(!['GRANTED','ON_DEMAND'].includes(grant.systemPermission)||grant.health==='UNAVAILABLE'||grant.checkedAt.getTime()>now.getTime()+1000||now.getTime()-grant.checkedAt.getTime()>300000)throw new BadRequestException('文件能力授权或健康状态需要刷新');
   if(input.manifestVersion!=='android-artifact-v1'||state!=='VERIFIED_PRESENT'||input.itemCount!==1||input.items?.length!==1)throw new BadRequestException('文件和分享需要单次明确授权的真实文件证据');
   const receipt=artifactAcquisitionItemSchema.safeParse(input.items[0]);
   if(!receipt.success||!artifactReceiptMatchesCapability(input.capability,receipt.data.acquisitionMethod)||receipt.data.receivedAt!==input.observedAt||input.observedAt<input.scopeStart||input.observedAt>=input.scopeEnd)throw new BadRequestException('文件来源或单次授权证据无效');
   const artifact=(await store.select().from(artifacts).where(and(eq(artifacts.id,receipt.data.artifactId),eq(artifacts.userId,userId))).limit(1))[0];
   if(!artifact||artifact.sourceSha256!==receipt.data.sourceSha256)throw new BadRequestException('文件不属于当前用户或内容摘要不一致');
   artifactRefs.push('artifact:'+artifact.id,'artifact-sha256:'+artifact.sourceSha256);
  }else if(input.manifestVersion==='android-artifact-v1'&&!artifactRead)throw new BadRequestException('文件读取合同不能用于其它能力');
  if(['network.status','battery.status'].includes(input.capability)&&['VERIFIED_PRESENT','VERIFIED_EMPTY'].includes(state)){
   const item=input.items?.[0];
   if(state!=='VERIFIED_PRESENT'||input.items?.length!==1||!item)throw new BadRequestException('设备状态不能报告空结果');
   if(input.capability==='network.status'&&(typeof item.connected!=='boolean'||typeof item.internetValidated!=='boolean'))throw new BadRequestException('网络状态证据无效');
   if(input.capability==='battery.status'&&(!Number.isInteger(item.level)||!Number.isInteger(item.scale)||(item.level as number)<0||(item.scale as number)<=0||(item.level as number)>(item.scale as number)||!Number.isInteger(item.status)))throw new BadRequestException('电池状态证据无效');
  }
  if(['VERIFIED_PRESENT','VERIFIED_EMPTY'].includes(state)){
   if(!Array.isArray(input.items)||input.itemCount!==input.items.length||!input.contentHash)throw new BadRequestException('Native read evidence incomplete');
   if(!input.contentJson||createHash('sha256').update(input.contentJson).digest('hex')!==input.contentHash)throw new BadRequestException('本机读取摘要不一致');
   let content;try{content=JSON.parse(input.contentJson);}catch{throw new BadRequestException('本机读取证据格式错误');}
   if(canonicalStringify(content)!==canonicalStringify(input.items))throw new BadRequestException('本机读取内容不一致');
   if(!artifactRead&&localCapabilityAvailability({key:input.capability,userGrant:grant.userGrant,systemPermission:grant.systemPermission as never,health:grant.health as never,checkedAt:grant.checkedAt.getTime()},now.getTime())!=='AVAILABLE')throw new BadRequestException('本机读取授权或健康证据已失效');
   if(state==='VERIFIED_EMPTY'&&input.itemCount!==0||state==='VERIFIED_PRESENT'&&input.itemCount===0)throw new BadRequestException('Native read count does not match state');
   if(now.getTime()-observedAt.getTime()>300000)state='STALE';
  }
  const existing=(await store.select().from(acquisitionRounds).where(and(eq(acquisitionRounds.userId,userId),eq(acquisitionRounds.requestId,requestId))).limit(1))[0];if(existing){if(existing.contentHash!==(input.contentHash??null)||existing.capability!==input.capability||existing.trustedDeviceId!==deviceId)throw new BadRequestException('不能复用不同内容的读取请求');return existing;}
  const id=newId(),sourceId=localCapabilitySourceId(deviceId,input.capability);
  const evidenceRefs=[`trusted-device:${deviceId}`,`signed-request:${requestId}`,`acquisition:${id}`,`local-grant:${grant.id}`,`manifest:${grant.manifestVersion}`,...artifactRefs];
  const row={id,userId,trustedDeviceId:deviceId,requestId,sourceId,capability:input.capability,manifestVersion:input.manifestVersion,state,itemCount:input.itemCount??null,contentHash:input.contentHash??null,observedAt,scopeStart:start,scopeEnd:end,evidenceRefsJson:evidenceRefs,reason:input.reason??(state==='VERIFIED_EMPTY'?'已验证此读取范围没有数据':state==='VERIFIED_PRESENT'?'已取得本机读取证据':'来源状态待处理'),createdAt:now};
  const truthIds:string[]=[];
  const persist=async(tx:RealityExecutor)=>{
   const device=(await tx.select().from(trustedDevices).where(and(eq(trustedDevices.id,deviceId),eq(trustedDevices.userId,userId))).limit(1).for('update'))[0];
   if(!device||device.status!=='active'||device.revokedAt)throw new BadRequestException('此设备的授权已撤销');
   const lockedGrant=(await tx.select().from(localCapabilityStates).where(eq(localCapabilityStates.id,grant.id)).for('update'))[0];
   if(!lockedGrant?.userGrant)throw new BadRequestException('本机能力授权已撤销');
   if(artifactRead&&['VERIFIED_PRESENT','VERIFIED_EMPTY'].includes(state)&&(!['GRANTED','ON_DEMAND'].includes(lockedGrant.systemPermission)||lockedGrant.health==='UNAVAILABLE'||Date.now()-lockedGrant.checkedAt.getTime()>300000))throw new BadRequestException('文件能力授权证据已变化');
   if(!artifactRead&&['VERIFIED_PRESENT','VERIFIED_EMPTY'].includes(state)&&localCapabilityAvailability({key:input.capability,userGrant:lockedGrant.userGrant,systemPermission:lockedGrant.systemPermission as never,health:lockedGrant.health as never,checkedAt:lockedGrant.checkedAt.getTime()},Date.now())!=='AVAILABLE')throw new BadRequestException('读取授权证据已变化');
   await tx.insert(acquisitionRounds).values(row);
   if(input.capability==='calendar.read'&&state==='VERIFIED_PRESENT'){
   for(const item of input.items??[]){
    const ingested=await this.reality.ingest(userId,{sourceMode:'NATIVE_OS',providerKey:'android-native',deviceId,externalEventKey:`${requestId}:${item.id}:${item.startAt}`,parserKey:'native.calendar-event.v1',resourceHint:'CalendarEvent',payload:{...item,nativeSourceId:sourceId,acquisitionId:id} as never,evidenceHash:input.contentHash!,observedAt:observedAt.toISOString()},0,tx);
    for(const candidate of ingested.candidates){const truth=await this.reality.confirmCandidate(userId,candidate.id,{verifiedBy:'trusted_native_read',verificationMethod:'signed_native_read_and_content_hash'},0,tx);truthIds.push(truth.id);}
   }
  }
   await this.audit.append({actorType:'user',actorUserId:userId,userId,action:'LOCAL_ACQUISITION_RECORDED',resourceType:'acquisition',resourceId:id,source:'api',result:['VERIFIED_PRESENT','VERIFIED_EMPTY'].includes(state)?'success':'blocked',after:{observedItems:['network.status','battery.status'].includes(input.capability)?input.items:undefined,state,capability:input.capability,itemCount:row.itemCount,evidenceRefs,truthIds,grantSnapshot:{userGrant:lockedGrant.userGrant,systemPermission:lockedGrant.systemPermission,health:lockedGrant.health,checkedAt:lockedGrant.checkedAt.toISOString(),perOperationArtifactConsent:artifactRead&&artifactRefs.length>0}},changeSummary:'Signed native acquisition and grant/health authority recorded; semantic facts retain the existing Reality verification chain'},tx);
  };
  if(parentTx)await persist(parentTx);else await this.db.transaction(persist);
  return {...row,truthIds};
 }
 async coverage(userId:string){const rows=await this.db.select().from(acquisitionRounds).where(eq(acquisitionRounds.userId,userId)).orderBy(desc(acquisitionRounds.createdAt)).limit(100);const rounds=rows.map(row=>({...row,state:['VERIFIED_EMPTY','VERIFIED_PRESENT'].includes(row.state)&&Date.now()-(row.observedAt?.getTime()??0)>300000?'STALE':row.state}));const latest=new Map<string,typeof rounds[number]>();for(const round of rounds)if(!latest.has(round.sourceId))latest.set(round.sourceId,round);return {evaluatedAt:new Date().toISOString(),rounds,sources:[...latest.values()],truncated:rows.length===100};}
}
