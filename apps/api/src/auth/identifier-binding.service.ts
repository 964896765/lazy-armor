import { ConflictException, ForbiddenException, HttpException, UnauthorizedException, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authIdentities, loginIdentifiers } from '@lazy-armor/database';
import { CurrentAccountProofService } from './current-account-proof';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { compare } from 'bcryptjs';
import { createHmac, randomBytes } from 'node:crypto';
import IORedis from 'ioredis';
import { type InjectedDatabase } from '../common/database.module';
import type { AuthenticatedUser } from '../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { RateLimiterService } from '../infrastructure/rate-limiter.service';
import { authTransaction, type AuthTransaction } from './auth-transaction';
import { LoginCodeService, type ChallengeScope } from './login-code.service';
import { maskIdentifier, normalizeIdentifier } from './login-identifier';
import { PasswordCredentialService } from './password-credential.service';
import { connectRequestRedis, createRequestRedis } from '../infrastructure/request-redis';
export interface StartIdentifierBinding { identifier: string; proof: 'password' | 'code'; password?: string; identifierId?: string; oldIdentifierId?: string }

export interface BindingState {
  userId: string;
  sessionId: string;
  email?: string; // Preserve deployed email challenges.
  phone?: string;
  passwordEpoch: string;
  source?: { id: string; epoch: string };
  replacing?: { id: string; epoch: string };
  stage: 'current' | 'target';
  expiresAt: number;
}

export abstract class IdentifierBindingService implements OnModuleInit, OnApplicationShutdown {
  private redis: IORedis;
  private readonly currentProof: CurrentAccountProofService;
 private readonly redisUrl: string;
  constructor(
    private readonly kind: 'email' | 'phone',
    protected readonly db: InjectedDatabase,
    protected readonly config: ConfigService,
    private readonly passwords: PasswordCredentialService,
    private readonly codes: LoginCodeService,
    private readonly limiter: RateLimiterService,
    protected readonly audit: AuditService,
    private readonly operation: 'bind' | 'change' = 'bind',
  ) {
    this.redisUrl=config.getOrThrow<string>('REDIS_URL');this.redis = createRequestRedis(this.redisUrl);
    this.currentProof = new CurrentAccountProofService(passwords);
  }
  onModuleInit() {
    if (this.config.get<string>(this.flag()) === 'true' && !this.passwords.unified()) throw new Error(`${this.kind} binding requires UNIFIED password credentials`);
  }
  protected additionalReady() { return true; }
  private enabled() { return this.config.get<string>(this.flag()) === 'true' && this.passwords.unified() && this.additionalReady() && (this.kind === 'phone' ? this.codes.availability('phone') === 'CONFIGURED' : this.codes.availability('email') !== 'UNAVAILABLE'); }
  private namespace() { return this.kind + (this.operation === 'change' ? '-change' : '-binding'); }
  private digest(value: string) { return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET')).update(this.namespace() + ':' + value).digest('hex'); }
  private key(challenge: string) { return `${this.config.get<string>('REDIS_KEY_PREFIX') ?? 'lazyarmor'}:${this.namespace()}:${this.digest(challenge)}`; }
  private scope(challenge: string, state: BindingState, purpose: ChallengeScope['purpose']): ChallengeScope {
    const context = [challenge, state.sessionId, this.target(state), state.passwordEpoch, state.source];
    if (state.replacing) context.push(state.replacing);
    return { purpose, userId: state.userId, context: this.digest(JSON.stringify(context)) };
  }
  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { if (error instanceof HttpException) throw error; this.redis.disconnect();this.redis=createRequestRedis(this.redisUrl);throw new HttpException(`验证服务暂不可用，请稍后重新开始${this.operation === 'change' ? '换号' : '绑定'}。`, 503); }
  }
  private flag() { return this.operation === 'change' ? 'AUTH_PHONE_CHANGE_ENABLED' : this.kind === 'email' ? 'AUTH_EMAIL_BIND_ENABLED' : 'AUTH_PHONE_BIND_ENABLED'; }
  private label() { return this.kind === 'email' ? '邮箱' : '手机号'; }
  protected invalid() { return new UnauthorizedException({ code: this.kind.toUpperCase() + (this.operation === 'change' ? '_CHANGE' : '_BIND') + '_PROOF_EXPIRED', message: '验证已失效，请重新验证当前账号。' }); }
  private occupied() { return new ConflictException({ code: this.kind.toUpperCase() + '_BIND_OCCUPIED', message: `该${this.label()}已有关联账号，请使用其他${this.label()}。账号不会自动合并。` }); }
  protected target(state: BindingState): string { const value = state[this.kind]; if (!value) throw this.invalid(); return value; }
  private purpose(stage: 'current' | 'target'): ChallengeScope['purpose'] { return `${this.kind}-${this.operation}-${stage}` as ChallengeScope['purpose']; }
  private assertEnabled() { if (!this.enabled()) throw new ForbiddenException(this.operation === 'change' ? '手机号更换暂未开放' : `新增${this.label()}绑定暂未开放`); }
  private async passwordEpoch(userId: string, reader: Pick<InjectedDatabase, 'select'> = this.db, lock = false) {
    // Redis holds only a keyed fingerprint, never a password/hash or a code.
    return this.currentProof.passwordEpoch(userId, reader, value => this.digest(value), lock);
  }
  private sourceEpoch(row: typeof loginIdentifiers.$inferSelect) { return this.currentProof.sourceEpoch(row, value => this.digest(value)); }
  protected async source(userId: string, id: string, reader: Pick<InjectedDatabase, 'select'> = this.db, lock = false) {
    try { return await this.currentProof.source(userId, id, reader, lock); }
    catch (error) { if (error instanceof UnauthorizedException) throw this.invalid(); throw error; }
  }
  private async assertSession(user: AuthenticatedUser, reader: Pick<InjectedDatabase, 'select'> = this.db, lock = false) {
    try { await this.currentProof.assertSession(user, reader, lock); }
    catch (error) { if (error instanceof UnauthorizedException) throw this.invalid(); throw error; }
  }
  private async validate(user: AuthenticatedUser, state: BindingState, tx?: AuthTransaction) {
    if (state.userId !== user.id || state.sessionId !== user.sessionId || state.expiresAt <= Date.now()) throw this.invalid();
    const reader = tx ?? this.db;
    await this.assertSession(user, reader, Boolean(tx));
    if (await this.passwordEpoch(user.id, reader, Boolean(tx)) !== state.passwordEpoch) throw this.invalid();
    if (state.source && this.sourceEpoch(await this.source(user.id, state.source.id, reader, Boolean(tx))) !== state.source.epoch) throw this.invalid();
    if (this.operation === 'change') {
      if (!state.replacing) throw this.invalid();
      const old = await this.source(user.id,state.replacing.id,reader,Boolean(tx));
      if (old.kind !== 'phone' || this.sourceEpoch(old) !== state.replacing.epoch) throw this.invalid();
    }
    if (state.expiresAt <= Date.now()) throw this.invalid();
  }
  private async load(user: AuthenticatedUser, challenge: string, stage: BindingState['stage']) {
    this.assertEnabled();
    await connectRequestRedis(this.redis);
    const raw = await this.redis.get(this.key(challenge));
    if (!raw) throw this.invalid();
    const state = JSON.parse(raw) as BindingState;
    if (state.stage !== stage) throw this.invalid();
    await this.validate(user, state);
    return { raw, state };
  }
  private async assertFree(identifier: string, tx?: AuthTransaction) {
    const reader = tx ?? this.db;
    const mappingQuery = reader.select({ id: loginIdentifiers.id }).from(loginIdentifiers).where(and(eq(loginIdentifiers.kind, this.kind), eq(loginIdentifiers.identifier, identifier))).limit(1);
    const known = (await (tx ? mappingQuery.for('update') : mappingQuery))[0];
    if (known) throw this.occupied();
    if (this.kind === 'email') {
      const query = reader.select({ id: authIdentities.id }).from(authIdentities).where(eq(authIdentities.email, identifier)).limit(1);
      if ((await (tx ? query.for('update') : query))[0]) throw this.occupied();
    }
  }
  protected async bindingCapabilities(user: AuthenticatedUser) {
    const enabled = this.enabled();
    const sources = enabled ? await this.db.select().from(loginIdentifiers).where(eq(loginIdentifiers.userId, user.id)) : [];
    return { available: enabled, sources: sources.filter(row => !row.disabledAt && ['email', 'phone'].includes(row.kind) && row.verifiedAt && this.codes.availability(row.kind as 'email' | 'phone') !== 'UNAVAILABLE').map(row => ({ id: row.id, kind: row.kind, masked: maskIdentifier(row.kind as 'email' | 'phone', row.identifier) })) };
  }
  protected async startBinding(user: AuthenticatedUser, input: StartIdentifierBinding, ip: string) {
    return this.guarded(async () => {
      this.assertEnabled();
      if (!(await this.limiter.consume('identifier-binding:user:' + user.id, 10, 300)).allowed || !(await this.limiter.consume('identifier-binding:ip:' + ip, 20, 300)).allowed) throw new HttpException('尝试次数过多，请稍后再试', 429);
      if ((input.proof === 'password' && (!input.password || input.identifierId)) || (input.proof === 'code' && (!input.identifierId || input.password))) throw new HttpException('请选择一种当前账号验证方式', 400);
      await this.assertSession(user);
      const identifier = normalizeIdentifier(this.kind, input.identifier);
      const observed = await this.passwords.observe(user.id);
      const state: BindingState = { userId: user.id, sessionId: user.sessionId!, [this.kind]: identifier, passwordEpoch: this.digest(JSON.stringify(observed ?? { userId: user.id, password: 'none' })), stage: input.proof === 'password' ? 'target' : 'current', expiresAt: Date.now() + 600_000 };
      if (this.operation === 'change') {
        if (!input.oldIdentifierId) throw this.invalid();
        const old = await this.source(user.id,input.oldIdentifierId);
        if (old.kind !== 'phone' || old.identifier === identifier) throw this.invalid();
        state.replacing = {id:old.id,epoch:this.sourceEpoch(old)};
      }
      if (input.proof === 'password') {
        if (!observed || !await compare(input.password!, observed.passwordHash)) throw new UnauthorizedException('当前账号密码验证失败');
      } else {
        const source = await this.source(user.id, input.identifierId!);
        state.source = { id: source.id, epoch: this.sourceEpoch(source) };
      }
      await this.assertFree(identifier);
      await this.validate(user, state);
      const challenge = randomBytes(32).toString('hex');
      await connectRequestRedis(this.redis);
      await this.redis.set(this.key(challenge), JSON.stringify(state), 'EX', 600);
      if (state.source) {
        try {
          const source = await this.source(user.id, state.source.id);
          const delivery = await this.codes.request({ kind: source.kind as 'email' | 'phone', identifier: source.identifier }, ip, this.scope(challenge, state, this.purpose('current')));
          return { challenge, stage: state.stage, challengeExpiresIn: 600, ...delivery };
        } catch (error) { await this.redis.del(this.key(challenge)); throw error; }
      }
      return { challenge, stage: state.stage, challengeExpiresIn: 600 };
    });
  }
  async confirmCurrent(user: AuthenticatedUser, challenge: string, code: string, ip: string) {
    return this.guarded(async () => {
      const { state, raw } = await this.load(user, challenge, 'current');
      const source = await this.source(user.id, state.source!.id);
      await this.codes.verify({ kind: source.kind as 'email' | 'phone', identifier: source.identifier, code }, ip, this.scope(challenge, state, this.purpose('current')));
      await this.validate(user, state);
      const next = { ...state, stage: 'target' as const };
      const accepted = await this.redis.eval("if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end;redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL');return 1", 1, this.key(challenge), raw, JSON.stringify(next));
      if (Number(accepted) !== 1) throw this.invalid();
      return { verified: true, stage: next.stage };
    });
  }
  async requestTarget(user: AuthenticatedUser, challenge: string, ip: string) {
    return this.guarded(async () => {
      const { state } = await this.load(user, challenge, 'target');
      await this.assertFree(this.target(state));
      return this.codes.request({ kind: this.kind, identifier: this.target(state) }, ip, this.scope(challenge, state, this.purpose('target')));
    });
  }
  async confirm(user: AuthenticatedUser, challenge: string, code: string, ip: string) {
    return this.guarded(async () => {
      const { state, raw } = await this.load(user, challenge, 'target');
      await this.codes.verify({ kind: this.kind, identifier: this.target(state), code }, ip, this.scope(challenge, state, this.purpose('target')));
      // Consume before SQL. A failed/rolled-back attempt requires fresh proofs;
      // Redis is never recreated after failure. External work stays outside retries.
      const accepted = await this.redis.eval("if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end;redis.call('DEL',KEYS[1]);return 1", 1, this.key(challenge), raw);
      if (Number(accepted) !== 1) throw this.invalid();
      return authTransaction(this.db, async tx => {
        // Same missing-key/index lock order as anonymous OTP/password registration.
        await this.assertFree(this.target(state), tx);
        await this.validate(user, state, tx);
        return this.finalize(tx,user,state);
      });
    });
  }
  protected async finalize(tx: AuthTransaction, user: AuthenticatedUser, state: BindingState): Promise<{bound?:boolean;changed?:boolean;reauthenticate?:boolean;notification?:string}> {
    const now = new Date();
    await tx.insert(loginIdentifiers).values({ id: newId(), userId: user.id, kind: this.kind, identifier: this.target(state), verifiedAt: now, createdAt: now, updatedAt: now });
    await this.audit.append({ actorType: 'user', actorUserId: user.id, userId: user.id, action: this.kind === 'email' ? 'LOGIN_EMAIL_BOUND' : 'LOGIN_PHONE_BOUND', resourceType: 'auth', resourceId: user.id, source: 'api', result: 'success', changeSummary: `Added a verified ${this.kind} to the original account with current-account and new-channel proofs` }, tx);
    return {bound:true};
  }
  async onApplicationShutdown() { this.redis.disconnect(); }
}
