import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { serviceMedia, serviceOfferings, serviceProviderProfiles, users } from '@lazy-armor/database';
import { and, eq } from 'drizzle-orm';
import { newId } from '@lazy-armor/shared';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

@Injectable()
export class ServiceMediaService {
 constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}
 async upload(userId: string, input: { requestId: string; contentBase64: string }) {
  if (input.contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)) throw new BadRequestException('图片编码无效');
  const source = Buffer.from(input.contentBase64, 'base64');
  if (!source.length || source.length > 8_000_000) throw new BadRequestException('图片最大 8 MB');
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  let normalized: Buffer; let width: number; let height: number;
  try {
   const image = sharp(source, { limitInputPixels: 50_000_000, animated: false });
   const metadata = await image.metadata();
   if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Unsupported image');
   const { data, info } = await image.rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
   normalized = data; width = info.width; height = info.height;
   if (normalized.length > 512000) throw new Error('Image budget exceeded');
  } catch { throw new BadRequestException('请选择有效的 JPEG、PNG 或 WebP 静态图片，最大 5000 万像素'); }
  return this.db.transaction(async tx => {
   const owner = (await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.status, 'active'))).for('update'))[0];
   if (!owner) throw new NotFoundException('账号不可用');
   const existing = (await tx.select().from(serviceMedia).where(and(eq(serviceMedia.userId, userId), eq(serviceMedia.requestId, input.requestId))))[0];
   if (existing) { if (existing.sourceSha256 !== sourceSha256) throw new ConflictException('同一请求标识不能用于不同图片'); return { id: existing.id, width: existing.payload.width, height: existing.payload.height }; }
   const count = await tx.select({ id: serviceMedia.id }).from(serviceMedia).where(eq(serviceMedia.userId, userId));
   if (count.length >= 100) throw new BadRequestException('最多保存 100 张服务图片');
   const id = newId(); await tx.insert(serviceMedia).values({ id, userId, requestId: input.requestId, sourceSha256, contentSha256: createHash('sha256').update(normalized).digest('hex'), sizeBytes: normalized.length, payload: { contentBase64: normalized.toString('base64'), width, height }, createdAt: new Date() });
   return { id, width, height };
  });
 }
 async publicImage(id: string) {
  const row = (await this.db.select({ media: serviceMedia }).from(serviceMedia).innerJoin(serviceOfferings, eq(serviceOfferings.imageMediaId, serviceMedia.id)).innerJoin(serviceProviderProfiles, eq(serviceOfferings.providerProfileId, serviceProviderProfiles.id)).where(and(eq(serviceMedia.id, id), eq(serviceOfferings.status, 'PUBLISHED'), eq(serviceProviderProfiles.status, 'ACTIVE'))).limit(1))[0];
  if (!row) throw new NotFoundException('图片不可用');
  return Buffer.from(row.media.payload.contentBase64, 'base64');
 }
}
