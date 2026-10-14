import { ForbiddenException, HttpException, Inject, Injectable, UnauthorizedException, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parsePasskeyConfig } from '@lazy-armor/config';
import { authIdentities, authSessions, loginIdentifiers, passkeyCredentials } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { and, eq, isNull } from 'drizzle-orm';
import { compare } from 'bcryptjs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type IORedis from 'ioredis';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { AuthenticatedUser } from '../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import { connectRequestRedis, createRequestRedis } from '../infrastructure/request-redis';
import { authTransaction, type AuthTransaction } from './auth-transaction';
import { CurrentAccountProofService } from './current-account-proof';
import { PasswordCredentialService } from './password-credential.service';
import { LoginCodeService, type ChallengeScope } from './login-code.service';
import { AuthService, type RequestContext } from './auth.service';
import { maskIdentifier } from './login-identifier';
import { passkeyUserHandle } from './passkey-proof';
import type { StartPasskeyDto, RegisterPasskeyDto, LoginPasskeyDto } from './passkey.dto';

interface State {
  operation: 'register'|'revoke'|'login'; stage: 'current'|'ready'|'webauthn'; expiresAt: number; configEpoch: string;
  userId?: string; sessionId?: string; passwordEpoch?: string; source?: {id:string;epoch:string};
  label?: string; target?: {id:string;version:number}; webChallenge?: string;
}
const ttl = 300;
const algorithms = [-7,-257,-8];
const credentialHash = (id: string) => createHash('sha256').update(id).digest('hex');

@Injectable()
export class PasskeyService implements OnModuleInit, OnApplicationShutdown {
  private redis: IORedis;
  private readonly redisUrl: string;
  private readonly settings: ReturnType<typeof parsePasskeyConfig>;
  private ready = false;
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly config: ConfigService,
    private readonly passwords: PasswordCredentialService, private readonly current: CurrentAccountProofService,
    private readonly codes: LoginCodeService, private readonly limiter: RateLimiterService,
    private readonly audit: AuditService, private readonly auth: AuthService) {
    this.redisUrl = config.getOrThrow<string>('REDIS_URL'); this.redis = createRequestRedis(this.redisUrl);
    const values = Object.fromEntries(['AUTH_PASSKEY_ENABLED','AUTH_PASSKEY_RP_ID','AUTH_PASSKEY_ORIGINS','NODE_ENV','APP_ENV'].map(key=>[key,config.get<string>(key)]));
    this.settings = parsePasskeyConfig(values);
  }
  async onModuleInit() {
    if (!this.settings) return;
    try { await this.db.select().from(passkeyCredentials).limit(1); this.ready = true; }
    catch { throw this.unavailable(); }
  }
  private invalid() { return new UnauthorizedException({code:'PASSKEY_VERIFICATION_FAILED',message:'通行密钥验证已失效，请重新开始或选择其他登录方式。'}); }
  private unavailable() { return new HttpException({code:'PASSKEY_SERVICE_UNAVAILABLE',message:'通行密钥服务暂不可用，请使用其他登录方式。'},503); }
  private digest = (value: string) => createHmac('sha256',this.config.getOrThrow<string>('JWT_SECRET')).update('passkey:'+value).digest('hex');
  private key(challenge: string) { return `${this.config.get<string>('REDIS_KEY_PREFIX')??'lazyarmor'}:passkey:${this.digest(challenge)}`; }
  private epoch() { return this.digest(JSON.stringify(this.settings)); }
  private enabled() { return this.ready && Boolean(this.settings); }
  private assertEnabled() { if (!this.enabled()) throw new ForbiddenException('通行密钥暂未开放'); }
  private async guarded<T>(work:()=>Promise<T>):Promise<T> {
    try { return await work(); } catch(error) {
      if(error instanceof HttpException)throw error;
      this.redis.disconnect();this.redis=createRequestRedis(this.redisUrl);throw this.unavailable();
    }
  }
  async capabilities(user?: AuthenticatedUser) {
    const available=this.enabled();
    if(!user)return {passkeyLogin:{available,origins:available?this.settings!.origins:[]}};
    if(!available)return {passkeysAvailable:false,passkeys:{available:false,origins:[],sources:[],credentials:[]}};
    const sources=await this.db.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.userId,user.id),isNull(loginIdentifiers.disabledAt)));
    const credentials=await this.active(user.id);
    return {passkeysAvailable:true,passkeys:{available:true,origins:this.settings!.origins,sources:sources.filter(row=>this.codes.availability(row.kind as 'email'|'phone')!=='UNAVAILABLE').map(row=>({id:row.id,kind:row.kind,masked:maskIdentifier(row.kind as 'email'|'phone',row.identifier)})),credentials:credentials.map(row=>({id:row.id,label:row.label,createdAt:row.createdAt.toISOString(),lastUsedAt:row.lastUsedAt?.toISOString()??null,backedUp:row.backedUp}))}};
  }
  private active(userId: string, reader: Pick<InjectedDatabase,'select'>=this.db) {
    return reader.select().from(passkeyCredentials).where(and(eq(passkeyCredentials.userId,userId),eq(passkeyCredentials.rpId,this.settings!.rpID),isNull(passkeyCredentials.revokedAt)));
  }
  private scope(challenge:string,state:State):ChallengeScope {
    return {purpose:state.operation==='register'?'passkey-register-current':'passkey-revoke-current',userId:state.userId!,context:this.digest(JSON.stringify([challenge,state.sessionId,state.passwordEpoch,state.source,state.label,state.target]))};
  }
  private async validate(user: AuthenticatedUser,state:State,tx?:AuthTransaction) {
    if(state.userId!==user.id||state.sessionId!==user.sessionId||state.expiresAt<=Date.now()||state.configEpoch!==this.epoch())throw this.invalid();
    const reader=tx??this.db;
    try {
      await this.current.assertSession(user,reader,Boolean(tx));
      if(await this.current.passwordEpoch(user.id,reader,this.digest,Boolean(tx))!==state.passwordEpoch)throw this.invalid();
      if(state.source&&this.current.sourceEpoch(await this.current.source(user.id,state.source.id,reader,Boolean(tx)),this.digest)!==state.source.epoch)throw this.invalid();
      if(state.expiresAt<=Date.now())throw this.invalid();
    } catch(error){if(error instanceof UnauthorizedException)throw this.invalid();throw error;}
  }
  private async load(challenge:string,operation:State['operation'],stage:State['stage'],user?:AuthenticatedUser) {
    this.assertEnabled();await connectRequestRedis(this.redis);
    const raw=await this.redis.get(this.key(challenge));if(!raw)throw this.invalid();
    const state=JSON.parse(raw) as State;
    if(state.operation!==operation||state.stage!==stage||state.expiresAt<=Date.now()||state.configEpoch!==this.epoch())throw this.invalid();
    if(operation!=='login'){if(!user)throw this.invalid();await this.validate(user,state);}
    return {raw,state};
  }
  private async transition(challenge:string,raw:string,next?:State) {
    const result=await this.redis.eval(next?"if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end;redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL');return 1":"if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end;redis.call('DEL',KEYS[1]);return 1",1,this.key(challenge),raw,...(next?[JSON.stringify(next)]:[]));
    if(Number(result)!==1)throw this.invalid();
  }
  private async limit(ip:string,userId?:string) {
    if(!(await this.limiter.consume('passkey:ip:'+this.digest(ip),30,300)).allowed||(userId&&!(await this.limiter.consume('passkey:user:'+userId,10,300)).allowed))throw new HttpException('尝试次数过多，请稍后再试',429);
  }
  async start(user:AuthenticatedUser,input:StartPasskeyDto,ip:string) {
    return this.guarded(async()=>{
      this.assertEnabled();await this.limit(ip,user.id);
      if((input.proof==='password'&&(!input.password||input.identifierId))||(input.proof==='code'&&(!input.identifierId||input.password))||(input.operation==='register'&&(!input.label||input.credentialId))||(input.operation==='revoke'&&(!input.credentialId||input.label)))throw new HttpException('请选择当前账号验证方式及通行密钥操作',400);
      await this.current.assertSession(user,this.db);
      const observed=await this.passwords.observe(user.id);
      const state:State={operation:input.operation,stage:input.proof==='password'?'ready':'current',userId:user.id,sessionId:user.sessionId!,passwordEpoch:await this.current.passwordEpoch(user.id,this.db,this.digest),expiresAt:Date.now()+ttl*1000,configEpoch:this.epoch(),label:input.label};
      if(input.proof==='password'){
        if(!observed||!await compare(input.password!,observed.passwordHash))throw this.invalid();
        // Freeze the exact password that was compared, not a later password read.
        if(this.digest(JSON.stringify(observed))!==state.passwordEpoch)throw this.invalid();
      }else{
        const source=await this.current.source(user.id,input.identifierId!,this.db);
        state.source={id:source.id,epoch:this.current.sourceEpoch(source,this.digest)};
      }
      if(input.operation==='revoke'){
        const row=(await this.active(user.id)).find(row=>row.id===input.credentialId);if(!row)throw this.invalid();state.target={id:row.id,version:row.version};
      }else if((await this.active(user.id)).length>=10)throw new HttpException('最多可添加 10 把通行密钥，请先移除不再使用的密钥。',409);
      await this.validate(user,state);
      const challenge=randomBytes(32).toString('hex');await connectRequestRedis(this.redis);await this.redis.set(this.key(challenge),JSON.stringify(state),'EX',ttl);
      if(state.source){try{
        const source=await this.current.source(user.id,state.source.id,this.db);
        const delivery=await this.codes.request({kind:source.kind as 'email'|'phone',identifier:source.identifier},ip,this.scope(challenge,state));
        return {challenge,stage:state.stage,challengeExpiresIn:ttl,...delivery};
      }catch(error){await this.redis.del(this.key(challenge));throw error;}}
      return {challenge,stage:state.stage,challengeExpiresIn:ttl};
    });
  }
  async confirmCurrent(user:AuthenticatedUser,challenge:string,code:string,ip:string) {
    return this.guarded(async()=>{
      // Operation is read from a server-owned challenge; neither request nor OTP can switch it.
      this.assertEnabled();await connectRequestRedis(this.redis);const raw=await this.redis.get(this.key(challenge));if(!raw)throw this.invalid();
      const state=JSON.parse(raw) as State;if(!['register','revoke'].includes(state.operation)||state.stage!=='current'||state.configEpoch!==this.epoch())throw this.invalid();
      await this.validate(user,state);const source=await this.current.source(user.id,state.source!.id,this.db);
      await this.codes.verify({kind:source.kind as 'email'|'phone',identifier:source.identifier,code},ip,this.scope(challenge,state));
      await this.validate(user,state);await this.transition(challenge,raw,{...state,stage:'ready'});return {verified:true,stage:'ready'};
    });
  }
  async registrationOptions(user:AuthenticatedUser,challenge:string) {
    return this.guarded(async()=>{
      const {raw,state}=await this.load(challenge,'register','ready',user);
      const options=await generateRegistrationOptions({rpName:'懒人装甲',rpID:this.settings!.rpID,userID:passkeyUserHandle(user.id),userName:'懒人装甲账号 '+user.id.slice(0,8),userDisplayName:'懒人装甲账号',timeout:60000,attestationType:'none',excludeCredentials:(await this.active(user.id)).map(row=>({id:row.credentialId,transports:row.transportsJson})),supportedAlgorithmIDs:algorithms,authenticatorSelection:{residentKey:'required',userVerification:'required'}});
      await this.transition(challenge,raw,{...state,stage:'webauthn',webChallenge:options.challenge});return {challenge,options};
    });
  }
  private clientData(encoded:string,expectedOrigin?:string) {
    try{const data=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));if((data.crossOrigin!==undefined&&data.crossOrigin!==false)||data.topOrigin!==undefined||(expectedOrigin&&data.origin!==expectedOrigin))throw this.invalid();return data;}
    catch{throw this.invalid();}
  }
  async register(user:AuthenticatedUser,input:RegisterPasskeyDto) {
    return this.guarded(async()=>{
      const {raw,state}=await this.load(input.challenge,'register','webauthn',user);await this.transition(input.challenge,raw);
      this.clientData(input.credential.response.clientDataJSON);
      let result;try{result=await verifyRegistrationResponse({response:input.credential,expectedChallenge:state.webChallenge!,expectedOrigin:this.settings!.origins,expectedRPID:this.settings!.rpID,expectedType:'webauthn.create',requireUserVerification:true,supportedAlgorithmIDs:algorithms});}catch{throw this.invalid();}
      if(!result.verified||!result.registrationInfo.userVerified||result.registrationInfo.credential.id!==input.credential.id)throw this.invalid();
      const info=result.registrationInfo;
      return authTransaction(this.db,async tx=>{
        await this.validate(user,state,tx);if((await this.active(user.id,tx)).length>=10)throw new HttpException('通行密钥数量已达上限',409);
        const id=newId();
        try{await tx.insert(passkeyCredentials).values({id,userId:user.id,credentialId:info.credential.id,credentialIdHash:credentialHash(info.credential.id),publicKey:Buffer.from(info.credential.publicKey).toString('base64url'),signCount:info.credential.counter,version:1,rpId:this.settings!.rpID,label:state.label!,transportsJson:input.credential.response.transports??[],aaguid:info.aaguid,deviceType:info.credentialDeviceType,backedUp:info.credentialBackedUp,createdAt:new Date()});}catch(error){if((error as {cause?:{code?:string};code?:string}).code==='ER_DUP_ENTRY'||(error as {cause?:{code?:string}}).cause?.code==='ER_DUP_ENTRY')throw this.invalid();throw error;}
        await this.audit.append({actorType:'user',actorUserId:user.id,userId:user.id,action:'PASSKEY_REGISTERED',resourceType:'passkey',resourceId:id,source:'api',result:'success',changeSummary:'User-verified Passkey bound to original account after current-account proof'},tx);return {registered:true,id};
      });
    });
  }
  async loginOptions(ip:string) {
    return this.guarded(async()=>{
      this.assertEnabled();await this.limit(ip);
      const options=await generateAuthenticationOptions({rpID:this.settings!.rpID,userVerification:'required',timeout:60000});
      const challenge=randomBytes(32).toString('hex'),state:State={operation:'login',stage:'webauthn',webChallenge:options.challenge,expiresAt:Date.now()+ttl*1000,configEpoch:this.epoch()};
      await connectRequestRedis(this.redis);await this.redis.set(this.key(challenge),JSON.stringify(state),'EX',ttl);return {challenge,options};
    });
  }
  async login(input:LoginPasskeyDto,context:RequestContext) {
    return this.guarded(async()=>{
      this.assertEnabled();await this.limit(context.ip??'unknown');
      const {raw,state}=await this.load(input.challenge,'login','webauthn');await this.transition(input.challenge,raw);
      this.clientData(input.credential.response.clientDataJSON);
      const observed=(await this.db.select().from(passkeyCredentials).where(eq(passkeyCredentials.credentialIdHash,credentialHash(input.credential.id))).limit(1))[0];
      if(!observed||observed.revokedAt||observed.rpId!==this.settings!.rpID||observed.credentialId!==input.credential.id)throw this.invalid();
      // userHandle is a consistency check only. Database credential ownership chooses userId.
      if(input.credential.response.userHandle&&input.credential.response.userHandle!==passkeyUserHandle(observed.userId).toString('base64url'))throw this.invalid();
      let result;try{result=await verifyAuthenticationResponse({response:input.credential,expectedChallenge:state.webChallenge!,expectedOrigin:this.settings!.origins,expectedRPID:this.settings!.rpID,expectedType:'webauthn.get',requireUserVerification:true,credential:{id:observed.credentialId,publicKey:Buffer.from(observed.publicKey,'base64url'),counter:observed.signCount,transports:observed.transportsJson as never}});}catch{throw this.invalid();}
      if(!result.verified||!result.authenticationInfo.userVerified||result.authenticationInfo.credentialDeviceType!==observed.deviceType)throw this.invalid();
      return this.auth.loginPasskey({observed,expiresAt:state.expiresAt,newCounter:result.authenticationInfo.newCounter,backedUp:result.authenticationInfo.credentialBackedUp},context);
    });
  }
  private async hasRecovery(userId:string,tx:AuthTransaction) {
    const rows=await tx.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.userId,userId),isNull(loginIdentifiers.disabledAt)));
    let usableRows=0;
    for(const row of rows){try{await this.current.source(userId,row.id,tx,true);usableRows++;if(this.codes.availability(row.kind as 'email'|'phone')!=='UNAVAILABLE')return true;}catch(error){if(!(error instanceof UnauthorizedException))throw error;}}
    if(!await this.passwords.observe(userId,tx,true))return false;
    const legacy=await tx.select().from(authIdentities).where(eq(authIdentities.userId,userId));
    if(this.passwords.unified()&&usableRows)return true;
    for(const identity of legacy){const conflict=(await tx.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.kind,'email'),eq(loginIdentifiers.identifier,identity.email))).limit(1))[0];if(!conflict||(!conflict.disabledAt&&conflict.userId===userId))return true;}
    return false;
  }
  async revoke(user:AuthenticatedUser,challenge:string) {
    return this.guarded(async()=>{
      const {raw,state}=await this.load(challenge,'revoke','ready',user);await this.transition(challenge,raw);
      return authTransaction(this.db,async tx=>{
        await this.validate(user,state,tx);
        const row=(await tx.select().from(passkeyCredentials).where(eq(passkeyCredentials.id,state.target!.id)).limit(1).for('update'))[0];
        if(!row||row.userId!==user.id||row.revokedAt||row.version!==state.target!.version||row.rpId!==this.settings!.rpID)throw this.invalid();
        if((await this.active(user.id,tx)).length<=1&&!await this.hasRecovery(user.id,tx))throw new HttpException('请先保留可用的邮箱、手机号或密码，再移除最后一把通行密钥。',409);
        const now=new Date();await tx.update(passkeyCredentials).set({revokedAt:now,version:row.version+1}).where(eq(passkeyCredentials.id,row.id));
        await tx.update(authSessions).set({revokedAt:now,revokeReason:'passkey_revoked'}).where(and(eq(authSessions.userId,user.id),isNull(authSessions.revokedAt)));
        await this.audit.append({actorType:'user',actorUserId:user.id,userId:user.id,action:'PASSKEY_REVOKED',resourceType:'passkey',resourceId:row.id,source:'api',result:'success',changeSummary:'Passkey revoked with fresh account proof; all sessions revoked'},tx);return {revoked:true,reauthenticate:true};
      });
    });
  }
  async onApplicationShutdown(){this.redis.disconnect();}
}
