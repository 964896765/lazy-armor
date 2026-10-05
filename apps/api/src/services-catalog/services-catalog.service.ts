import {normalizeServiceFulfillment} from '@lazy-armor/plan-schema';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { serviceMedia, serviceOfferings, serviceProviderProfiles, users, profiles } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { AuditService } from '../audit/audit.service';
import { safeServiceUrl } from '../consumer/projection-policy';
import type { PublishServiceDto, UpdateServiceOfferingDto } from './dto';

@Injectable()
export class ServicesCatalogService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly audit: AuditService) {}

  private fulfillment(input:Parameters<typeof normalizeServiceFulfillment>[0]){try{return normalizeServiceFulfillment(input);}catch(error){throw new BadRequestException(error instanceof Error?error.message:'服务交付信息无效');}}

  async listOwned(userId: string) {
    const rows = await this.db.select({ offering: serviceOfferings }).from(serviceOfferings)
      .innerJoin(serviceProviderProfiles, eq(serviceOfferings.providerProfileId, serviceProviderProfiles.id))
      .where(eq(serviceProviderProfiles.userId, userId)).orderBy(desc(serviceOfferings.updatedAt));
    return rows.map(row => row.offering);
  }

  async updateOwned(userId: string, id: string, input: UpdateServiceOfferingDto) {
    if(input.serviceType!==undefined&&!input.serviceType.trim())throw new BadRequestException('请填写具体服务类型');
    if (!input.confirmed || !input.title.trim() || !input.summary.trim() || !input.contact.trim()) throw new BadRequestException('请填写完整信息并确认保存');
    await this.db.transaction(async tx => {
      const row = (await tx.select({ offering: serviceOfferings, provider: serviceProviderProfiles }).from(serviceOfferings)
        .innerJoin(serviceProviderProfiles, eq(serviceOfferings.providerProfileId, serviceProviderProfiles.id))
        .where(and(eq(serviceOfferings.id, id), eq(serviceProviderProfiles.userId, userId))).for('update'))[0];
      if (!row) throw new ForbiddenException('无法管理此服务');
      if (row.offering.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ConflictException('服务信息已更新，请刷新后重试');
      if (input.status === 'PUBLISHED' && row.provider.status !== 'ACTIVE') throw new ForbiddenException('当前服务方无法发布服务');
      const fulfillment=this.fulfillment({...row.offering,...input,deliveryMode:input.deliveryMode??row.offering.deliveryMode,priceMode:input.priceMode??(input.priceMinor===undefined?row.offering.priceMode:'STARTING_FROM'),priceMinor:input.priceMinor??(input.priceMode===undefined?row.offering.priceMinMinor:undefined),remoteInstructions:input.remoteInstructions??(input.priceMode===undefined&&input.serviceArea!==undefined&&(input.deliveryMode??row.offering.deliveryMode)==='REMOTE'?input.serviceArea:row.offering.remoteInstructions)});
      await tx.update(serviceOfferings).set({ ...fulfillment,domain:input.domain??row.offering.domain,serviceType:input.serviceType?.trim()??row.offering.serviceType,title: input.title.trim(), summary: input.summary.trim(), contact: input.contact.trim(), status: input.status, updatedAt: new Date() }).where(eq(serviceOfferings.id, id));
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: 'SERVICE_OFFERING_UPDATED', resourceType: 'service_offering', resourceId: id, source: 'api', result: 'success', changeSummary: 'Owner confirmed service offering update', before: { status: row.offering.status }, after: { status: input.status } }, tx);
    });
    return (await this.listOwned(userId)).find(row => row.id === id);
  }

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
      deliveryModes: offering.deliveryModes,
      priceMode: offering.priceMode,
      serviceAddress:offering.serviceAddress,locationInstructions:offering.locationInstructions,
      remoteInstructions:offering.remoteInstructions,shippingInstructions:offering.shippingInstructions,
      shippingFeeRules:offering.shippingFeeRules,deliveryInstructions:offering.deliveryInstructions,bookingInstructions:offering.bookingInstructions,
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
    if((input.serviceType!==undefined||input.priceMode!==undefined)&&!input.serviceType?.trim())throw new BadRequestException('请填写具体服务类型');
    if (!input.confirmed || !input.title.trim() || !input.summary.trim() || !input.contact.trim()) throw new BadRequestException('请填写完整信息并确认发布');
    const imageUrl = input.imageUrl ? safeServiceUrl(input.imageUrl) : null;
    if (input.imageUrl && input.imageMediaId) throw new BadRequestException('请选择上传图片或图片链接中的一种');
    if (input.imageUrl && (!imageUrl || !imageUrl.startsWith('https://'))) throw new BadRequestException('图片地址必须是公开 HTTPS 图片链接');
    if(!input.domain||!input.deliveryMode)throw new BadRequestException('请选择领域与服务方式');
    const fields = { ...this.fulfillment({...input,deliveryMode:input.deliveryMode}),serviceType:input.serviceType?.trim()||'USER_SERVICE',title: input.title.trim(), summary: input.summary.trim(), domain: input.domain, contact: input.contact.trim(), imageUrl, imageMediaId: input.imageMediaId ?? null, status: input.status ?? 'PUBLISHED' };
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
        if (Object.entries(fields).some(([key, value]) => JSON.stringify(existing[key as keyof typeof existing]) !== JSON.stringify(value))) throw new ConflictException('同一发布请求不能用于不同内容');
        return existing.id;
      }
      const offeringId = newId();
      await tx.insert(serviceOfferings).values({ ...fields, id: offeringId, providerProfileId: profile.id, publishRequestId: input.requestId, tagsJson: [], ratingBasisPoints: null, useCount: 0, createdAt: now, updatedAt: now });
      await this.audit.append({ actorType: 'user', actorUserId: userId, userId, action: input.status==='DRAFT'?'SERVICE_OFFERING_DRAFT_SAVED':'SERVICE_OFFERING_PUBLISHED', resourceType: 'service_offering', resourceId: offeringId, correlationId: offeringId, source: 'api', result: 'success', changeSummary: 'User confirmed publication of their own service offering', after: { offeringId, providerProfileId: profile.id, initiation: 'MANUAL_USER_CONFIRMATION' } }, tx);
      return offeringId;
    });
    return input.status === 'DRAFT' ? (await this.listOwned(userId)).find(offering => offering.id === id) : (await this.listPublished()).find(offering => offering.id === id);
  }
}

