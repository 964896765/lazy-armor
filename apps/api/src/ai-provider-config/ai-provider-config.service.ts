import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { aiProviderConfigs, credentialRefs, credentialVersions, users } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../credentials/credential-provider';
import type { SaveAiProviderDto } from './ai-provider-config.controller';
import { serverDevelopmentAi } from './server-development-ai';
@Injectable()
export class AiProviderConfigService {
 constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider) {}
 private async row(userId: string) { return (await this.db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.userId, userId)).limit(1))[0]; }
 async get(userId: string) { const row = await this.row(userId); const server = !row ? serverDevelopmentAi() : null; return { provider: 'deepseek', configured: Boolean(row?.enabled || server), userConfigured: Boolean(row?.enabled), source: row ? 'USER' : server ? 'SERVER_DEVELOPMENT' : null, maskedKey: row?.maskedKey ?? null, model: row?.model ?? server?.model ?? 'deepseek-flash', thinkingMode: row?.thinkingMode ?? 'AUTO', status: row?.testedAt ? '已连接' : row ? '待测试' : server ? '服务器开发配置 · 待测试' : '未配置', testedAt: row?.testedAt?.toISOString() ?? null }; }
 async save(userId: string, input: SaveAiProviderDto) { const existing = await this.row(userId); if (!input.apiKey && !existing) throw new BadRequestException('请填写 DeepSeek API Key'); let providerRef: string | undefined; let previousCredentialId: string | undefined;
  if (input.apiKey) providerRef = await this.credentials.set({ apiKey: input.apiKey });
  try { await this.db.transaction(async tx => { await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update'); const locked = (await tx.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.userId, userId)).for('update'))[0]; if (!input.apiKey && !locked) throw new BadRequestException('请填写 API Key'); const now = new Date(); previousCredentialId = locked?.credentialId; let credentialId = locked?.credentialId; if (providerRef) { credentialId = newId(); await tx.insert(credentialRefs).values({ id: credentialId, ref: providerRef, provider: 'deepseek', status: 'active', currentVersion: 1, createdAt: now, updatedAt: now }); await tx.insert(credentialVersions).values({ id: newId(), credentialRefId: credentialId, version: 1, providerRef, status: 'active', createdAt: now }); } const fields = { provider: 'deepseek', model: input.model, thinkingMode: input.thinkingMode, credentialId: credentialId!, maskedKey: input.apiKey ? `sk-••••${input.apiKey.slice(-4)}` : locked!.maskedKey, enabled: 1, testedAt: null, updatedAt: now }; if (locked) await tx.update(aiProviderConfigs).set(fields).where(eq(aiProviderConfigs.id, locked.id)); else await tx.insert(aiProviderConfigs).values({ ...fields, id: newId(), userId, createdAt: now }); }); } catch (error) { if (providerRef) await this.credentials.revoke(providerRef); throw error; }
  if (providerRef && previousCredentialId) { const old = (await this.db.select().from(credentialRefs).where(eq(credentialRefs.id, previousCredentialId)))[0]; if (old) { await this.credentials.revoke(old.ref); await this.db.update(credentialRefs).set({ status: 'revoked', updatedAt: new Date() }).where(eq(credentialRefs.id, old.id)); } } return this.get(userId);
 }
 async resolve(userId: string) { const config = await this.row(userId); if (!config) { const server = serverDevelopmentAi(); if (server) return server; } if (!config?.enabled) throw new ServiceUnavailableException('AI_NOT_CONFIGURED'); const ref = (await this.db.select().from(credentialRefs).where(eq(credentialRefs.id, config.credentialId)))[0]; if (!ref || ref.status !== 'active') throw new ServiceUnavailableException('AI_CREDENTIAL_UNAVAILABLE'); const credential = await this.credentials.get(ref.ref, ref.currentVersion); return { apiKey: credential.apiKey, model: config.model, thinkingMode: config.thinkingMode, credentialId: config.credentialId }; }
 async test(userId: string) { const config = await this.resolve(userId); let response: Response; try { response = await fetch('https://api.deepseek.com/models', { headers: { authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(15000) }); } catch { throw new ServiceUnavailableException('连接超时，请检查网络'); } if (!response.ok) throw new BadRequestException(response.status === 401 ? 'API Key 无效，请修改后重试' : 'DeepSeek 暂不可用'); const payload = await response.json() as { data?: Array<{ id: string }> }; if (!payload.data?.some(item => item.id === config.model)) throw new BadRequestException('此账号暂不支持所选模型，请更换模型'); const testedAt = new Date(); if (config.credentialId) await this.db.update(aiProviderConfigs).set({ testedAt }).where(and(eq(aiProviderConfigs.userId, userId), eq(aiProviderConfigs.credentialId, config.credentialId), eq(aiProviderConfigs.model, config.model))); return { ...await this.get(userId), status: '已连接', testedAt: testedAt.toISOString() }; }
 async remove(userId: string) {
  let providerRef: string | undefined;
  await this.db.transaction(async tx => {
   await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
   const config = (await tx.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.userId, userId)).for('update'))[0];
   if (!config) return;
   const ref = (await tx.select().from(credentialRefs).where(eq(credentialRefs.id, config.credentialId)))[0];
   await tx.delete(aiProviderConfigs).where(eq(aiProviderConfigs.id, config.id));
   if (ref) { providerRef = ref.ref; await tx.update(credentialRefs).set({ status: 'revoked', updatedAt: new Date() }).where(eq(credentialRefs.id, ref.id)); }
  });
  if (providerRef) await this.credentials.revoke(providerRef);
  return this.get(userId);
 }
}
