import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { artifacts, users } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { ArtifactExtractorService } from './artifact-extractor.service';
import { AuditService } from '../audit/audit.service';
@Injectable()
export class ArtifactService {
 constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly extractor: ArtifactExtractorService, private readonly audit: AuditService) {}
 async import(userId: string, input: { fileName: string; mimeType: string; contentBase64: string; requestId: string }) {
  if (input.contentBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)) throw new BadRequestException('文件编码无效');
  const bytes = Buffer.from(input.contentBase64, 'base64'); if (!bytes.length || bytes.length > 2_000_000 || /[\x00-\x1f/\\]/.test(input.fileName)) throw new BadRequestException('文件名称无效或文件超过 2 MB');
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const prior = (await this.db.select().from(artifacts).where(and(eq(artifacts.userId, userId), eq(artifacts.requestId, input.requestId))).limit(1))[0];
  if (prior) { if (prior.sourceSha256 !== sourceSha256 || prior.fileName !== input.fileName || prior.mimeType !== input.mimeType) throw new ConflictException('文件请求标识已用于不同内容'); return this.project(prior); }
  const extracted = await this.extractor.extract(input.fileName, input.mimeType, input.contentBase64);
  const row = await this.db.transaction(async tx => {
   await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
   const replay = (await tx.select().from(artifacts).where(and(eq(artifacts.userId, userId), eq(artifacts.requestId, input.requestId))))[0];
   if (replay) { if (replay.sourceSha256 !== sourceSha256 || replay.fileName !== input.fileName || replay.mimeType !== input.mimeType) throw new ConflictException('文件请求标识已用于不同内容'); return replay; }
   const artifact = { id: newId(), userId, requestId: input.requestId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: bytes.length, sourceSha256, sourceBase64: input.contentBase64, extractorKey: extracted.extractorKey, extractionStatus: 'EXTRACTED', extractedText: extracted.text, extractedSha256: extracted.contentSha256, extractionMetadata: extracted.metadata, createdAt: new Date() };
   await tx.insert(artifacts).values(artifact);
   await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'ARTIFACT_EXTRACTED', resourceType: 'artifact', resourceId: artifact.id, correlationId: artifact.id, after: { sourceSha256, extractorKey: artifact.extractorKey, status: 'EXTRACTED', provenance: 'UNVERIFIED' }, source: 'api', result: 'success' }, tx);
   return artifact;
  });
  return this.project(row);
 }
 async owned(userId: string, id: string) { const row = (await this.db.select().from(artifacts).where(and(eq(artifacts.id, id), eq(artifacts.userId, userId))).limit(1))[0]; if (!row) throw new NotFoundException('文件不存在'); return row; }
 async get(userId: string, id: string) { return this.project(await this.owned(userId, id)); }
 private project(row: typeof artifacts.$inferSelect) { return { id: row.id, sourceRef: { type: 'Artifact', id: row.id }, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, sourceSha256: row.sourceSha256, extractorKey: row.extractorKey, extractionStatus: row.extractionStatus, extractedSha256: row.extractedSha256, metadata: row.extractionMetadata, createdAt: row.createdAt }; }
}
