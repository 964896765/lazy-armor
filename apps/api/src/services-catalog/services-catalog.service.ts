import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { serviceMedia, serviceOfferings, serviceProviderProfiles, users, profiles } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { safeServiceUrl } from '../consumer/projection-policy';
import type { PublishServiceDto } from './dto';

@Injectable()
export class ServicesCatalogService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  async listPublished() {
    const rows = await this.db.select({ offering: serviceOfferings, provider: serviceProviderProfiles })
      .from(serviceOfferings)
      .innerJoin(serviceProviderProfiles, eq(serviceOfferings.providerProfileId, serviceProviderProfiles.id))
      .where(and(eq(serviceOfferings.status, 'PUBLISHED'), eq(serviceProviderProfiles.status, 'ACTIVE')))
      .orderBy(desc(serviceOfferings.createdAt));
    return rows.map(({ offering, provider }) => ({
      id: offering.id,
      domain: offering.domain,
      serviceType: offering.serviceType,
      deliveryMode: offering.deliveryMode,
      title: offering.title,
      summary: offering.summary,
      tags: offering.tagsJson,
      priceMinMinor: offering.priceMinMinor,
      priceMaxMinor: offering.priceMaxMinor,
      currency: offering.currency,
      ratingBasisPoints: offering.ratingBasisPoints,
      useCount: offering.useCount,
      imageUrl: offering.imageMediaId ? `/api/service-media/${offering.imageMediaId}` : offering.imageUrl,
      serviceArea: offering.serviceArea,
      contact: offering.contact,
      provider: { id: provider.id, displayName: provider.displayName, verified: Boolean(provider.verifiedAt) },
    }));
  }

  async profileForUser(userId: string) {
    const profile = (await this.db.select().from(serviceProviderProfiles).where(eq(serviceProviderProfiles.userId, userId)).limit(1))[0];
    if (!profile) return { exists: false, canPublish: true, verified: false };
    return { id: profile.id, displayName: profile.displayName, status: profile.status, verified: Boolean(profile.verifiedAt), exists: true, canPublish: profile.status === 'ACTIVE' };
  }

  /** Explicit user-authored catalog publication. This endpoint is not an Agent/MCP execution tool. */
  async publish(userId: string, input: PublishServiceDto) {
    if (!input.confirmed || !input.title.trim() || !input.summary.trim() || !input.serviceArea.trim() || !input.contact.trim()) throw new BadRequestException('请填写完整信息并确认发布');
    const imageUrl = input.imageUrl ? safeServiceUrl(input.imageUrl) : null;
    if (input.imageUrl && input.imageMediaId) throw new BadRequestException('请选择上传图片或图片链接中的一种');
    if (input.imageUrl && (!imageUrl || !imageUrl.startsWith('https://'))) throw new BadRequestException('图片地址必须是公开 HTTPS 图片链接');
    const fields = { title: input.title.trim(), summary: input.summary.trim(), domain: input.domain, deliveryMode: input.deliveryMode, serviceArea: input.serviceArea.trim(), contact: input.contact.trim(), priceMinMinor: input.priceMinor ?? null, imageUrl, imageMediaId: input.imageMediaId ?? null };
    const id = await this.db.transaction(async tx => {
      const owner = (await tx.select({ id: users.id, displayName: profiles.displayName, status: users.status }).from(users).innerJoin(profiles, eq(users.id, profiles.userId)).where(eq(users.id, userId)).for('update'))[0];
      if (!owner || owner.status !== 'active') throw new ForbiddenException('账号不可用');
      if (input.imageMediaId && !(await tx.select({ id: serviceMedia.id }).from(serviceMedia).where(and(eq(serviceMedia.id, input.imageMediaId), eq(serviceMedia.userId, userId))).limit(1))[0]) throw new BadRequestException('图片不属于当前账号');
      let profile = (await tx.select().from(serviceProviderProfiles).where(eq(serviceProviderProfiles.userId, userId)).for('update'))[0];
      const now = new Date();
      if (!profile) {
        const profileId = newId();
        await tx.insert(serviceProviderProfiles).values({ id: profileId, userId, displayName: owner.displayName, status: 'ACTIVE', verifiedAt: null, createdAt: now, updatedAt: now });
        profile = (await tx.select().from(serviceProviderProfiles).where(eq(serviceProviderProfiles.id, profileId)))[0];
      }
      if (!profile || profile.status !== 'ACTIVE') throw new ForbiddenException('当前账号不能发布服务');
      const existing = (await tx.select().from(serviceOfferings).where(and(eq(serviceOfferings.providerProfileId, profile.id), eq(serviceOfferings.publishRequestId, input.requestId))))[0];
      if (existing) {
        if (Object.entries(fields).some(([key, value]) => existing[key as keyof typeof existing] !== value)) throw new ConflictException('同一发布请求不能用于不同内容');
        return existing.id;
      }
      const offeringId = newId();
      await tx.insert(serviceOfferings).values({ ...fields, id: offeringId, providerProfileId: profile.id, publishRequestId: input.requestId, serviceType: 'USER_SERVICE', tagsJson: [], priceMaxMinor: input.priceMinor ?? null, currency: input.priceMinor === undefined ? null : 'CNY', ratingBasisPoints: null, useCount: 0, status: 'PUBLISHED', createdAt: now, updatedAt: now });
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'SERVICE_OFFERING_PUBLISHED', resourceType: 'service_offering', resourceId: offeringId, correlationId: offeringId, source: 'api', result: 'success', changeSummary: 'User confirmed publication of their own service offering', after: { offeringId, providerProfileId: profile.id, initiation: 'MANUAL_USER_CONFIRMATION' } }, tx);
      return offeringId;
    });
    return (await this.listPublished()).find(offering => offering.id === id);
  }
}
