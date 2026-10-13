import { ConflictException, Inject, Injectable, UnauthorizedException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authIdentities, loginIdentifiers, passwordCredentials, users } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { authTransaction, type AuthTransaction } from './auth-transaction';

export interface PasswordProof {
  userId: string;
  passwordHash: string;
  sourceLegacyIdentityId?: string;
  credentialId?: string;
  version?: number;
}
type Reader = Pick<InjectedDatabase, 'select'>;
function conflict(): never {
  throw new ConflictException({code:'PASSWORD_CREDENTIAL_CONFLICT',message:'密码凭据记录需要核对，请联系支持处理。'});
}
function parameters(passwordHash: string) {
  const parsed = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/.exec(passwordHash);
  if (!parsed) return conflict();
  return {cost:Number(parsed[1])};
}

@Injectable()
export class PasswordCredentialService implements OnModuleInit {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly config: ConfigService, private readonly audit: AuditService) {}

  async onModuleInit() {
    if(this.mode()==='LEGACY')return;
    try{await this.db.select({version:passwordCredentials.version}).from(passwordCredentials).limit(1);}
    catch{throw new Error('Apply migration 0093 before enabling SHADOW or UNIFIED password credentials');}
  }

  mode(): 'LEGACY'|'SHADOW'|'UNIFIED' {
    const mode=this.config.get<string>('AUTH_PASSWORD_CREDENTIAL_MODE')??'LEGACY';
    if (!['LEGACY','SHADOW','UNIFIED'].includes(mode)) throw new Error('Invalid password credential mode');
    return mode as 'LEGACY'|'SHADOW'|'UNIFIED';
  }
  unified() {return this.mode()==='UNIFIED';}

  async observe(userId:string, reader:Reader=this.db, lock=false):Promise<PasswordProof|undefined> {
    const query=reader.select().from(authIdentities).where(eq(authIdentities.userId,userId));
    const legacy=await (lock?query.for('update'):query);
    if (legacy.length>1) return conflict();
    const old=legacy[0];
    if(this.mode()==='LEGACY') return old?{userId,passwordHash:old.passwordHash,sourceLegacyIdentityId:old.id}:undefined;
    const modernQuery=reader.select().from(passwordCredentials).where(eq(passwordCredentials.userId,userId)).limit(1);
    const modern=(await (lock?modernQuery.for('update'):modernQuery))[0];
    if(modern) {
      const expected=parameters(modern.passwordHash);
      if(modern.algorithm!=='bcrypt'||modern.version<1||modern.parametersJson?.cost!==expected.cost) return conflict();
      if(old&&(old.passwordHash!==modern.passwordHash||modern.sourceLegacyIdentityId!==old.id)) return conflict();
      if(this.mode()==='SHADOW'&&!old) return conflict();
      return {userId,passwordHash:modern.passwordHash,sourceLegacyIdentityId:old?.id,credentialId:modern.id,version:modern.version};
    }
    if(old) {parameters(old.passwordHash);return {userId,passwordHash:old.passwordHash,sourceLegacyIdentityId:old.id};}
    return undefined;
  }

  async seed(tx:AuthTransaction,userId:string,identityId:string,passwordHash:string,now:Date):Promise<PasswordProof> {
    const proof:PasswordProof={userId,passwordHash,sourceLegacyIdentityId:identityId};
    if(this.mode()==='LEGACY') return proof;
    const id=newId();
    await tx.insert(passwordCredentials).values({id,userId,passwordHash,algorithm:'bcrypt',parametersJson:parameters(passwordHash),version:1,sourceLegacyIdentityId:identityId,changedAt:now,createdAt:now,updatedAt:now});
    return {...proof,credentialId:id,version:1};
  }

  async assertCurrent(tx:AuthTransaction,proof:PasswordProof,promote=true) {
    let current=await this.observe(proof.userId,tx,true);
    if(!current||current.passwordHash!==proof.passwordHash||
      (proof.sourceLegacyIdentityId&&current.sourceLegacyIdentityId!==proof.sourceLegacyIdentityId)||
      (proof.credentialId&&(proof.credentialId!==current.credentialId||proof.version!==current.version))||
      (!proof.credentialId&&current.credentialId&&current.version!==1)) {
      throw new UnauthorizedException('当前密码证明已失效，请重新验证。');
    }
    if(promote&&this.mode()!=='LEGACY'&&!current.credentialId) {
      current=await this.seed(tx,proof.userId,current.sourceLegacyIdentityId!,current.passwordHash,new Date());
      await this.audit.append({actorType:'system',userId:proof.userId,action:'PASSWORD_CREDENTIAL_BACKFILLED',resourceType:'auth',resourceId:proof.userId,source:'api',result:'success',changeSummary:'Copied existing bcrypt credential to the same user; no password or identifier change'},tx);
    }
    return current;
  }

  async change(tx:AuthTransaction,proof:PasswordProof,passwordHash:string,now:Date) {
    const current=await this.assertCurrent(tx,proof);
    const [updated]=await tx.update(authIdentities).set({passwordHash,updatedAt:now}).where(eq(authIdentities.userId,proof.userId));
    if(!current.credentialId&&updated.affectedRows!==1) throw new UnauthorizedException('密码凭据不可用');
    if(current.credentialId) await tx.update(passwordCredentials).set({passwordHash,parametersJson:parameters(passwordHash),version:current.version!+1,changedAt:now,updatedAt:now}).where(eq(passwordCredentials.id,current.credentialId));
  }

  // Explicit, idempotent backfill used only by the isolated migration command/tests.
  async backfillUser(userId:string) {
    if(this.mode()==='LEGACY') throw new Error('Backfill requires SHADOW or UNIFIED mode');
    return authTransaction(this.db,async tx=>{
      const user=(await tx.select().from(users).where(eq(users.id,userId)).limit(1).for('update'))[0];
      if(!user) throw new UnauthorizedException('账号不存在');
      const observed=await this.observe(userId,tx,true);
      if(!observed) return {migrated:false,reason:'NO_PASSWORD'};
      if(observed.credentialId&&!observed.sourceLegacyIdentityId) return {migrated:false,reason:'ALREADY_MIGRATED'};
      const legacy=(await tx.select().from(authIdentities).where(eq(authIdentities.id,observed.sourceLegacyIdentityId!)).limit(1))[0];
      if(!legacy) return conflict();
      const mapping=(await tx.select().from(loginIdentifiers).where(and(eq(loginIdentifiers.kind,'email'),eq(loginIdentifiers.identifier,legacy.email))).limit(1).for('update'))[0];
      if(mapping&&mapping.userId!==userId) return conflict();
      await this.assertCurrent(tx,observed);
      return {migrated:!observed.credentialId,reason:observed.credentialId?'ALREADY_MIGRATED':'COPIED'};
    });
  }
}
