import { Inject, Injectable } from '@nestjs/common';
import { serviceOfferings, serviceProviderProfiles } from '@lazy-armor/database';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';

@Injectable()
export class ServicesCatalogService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

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
      title: offering.title,
      summary: offering.summary,
      tags: offering.tagsJson,
      priceMinMinor: offering.priceMinMinor,
      priceMaxMinor: offering.priceMaxMinor,
      currency: offering.currency,
      ratingBasisPoints: offering.ratingBasisPoints,
      useCount: offering.useCount,
      imageUrl: offering.imageUrl,
      provider: { id: provider.id, displayName: provider.displayName, verified: Boolean(provider.verifiedAt) },
    }));
  }

  async profileForUser(userId: string) {
    const profile = (await this.db.select().from(serviceProviderProfiles).where(eq(serviceProviderProfiles.userId, userId)).limit(1))[0];
    if (!profile) return { exists: false, canPublish: false };
    return { id: profile.id, displayName: profile.displayName, status: profile.status, verified: Boolean(profile.verifiedAt), exists: true, canPublish: profile.status === 'ACTIVE' };
  }
}
