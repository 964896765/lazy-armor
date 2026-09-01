import { Inject, Injectable } from '@nestjs/common';
import { masterContents, platformVariants } from '@lazy-armor/database';
import { newId } from '@lazy-armor/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CONTENT_PLATFORMS, type ContentPlatform } from './dto';

type ContentContext = Record<string, unknown>;

interface MasterContentShape {
  id?: string;
  title: string;
  body: string | null;
  mediaReferences: string[];
  coverReference: string | null;
  tags: string[];
  sourceType: string;
}

interface GeneratedPlatformVariant {
  platform: ContentPlatform;
  title: string;
  description: string;
  tags: string[];
  coverRequirements: string;
  publishStatus: 'draft_ready' | 'needs_revision' | 'prepared';
  validationResult: {
    valid: boolean;
    issues: string[];
    titleLength: number;
    descriptionLength: number;
    tagCount: number;
  };
}

const PLATFORM_RULES: Record<ContentPlatform, { label: string; titleMax: number; descriptionMax: number; tagsMax: number; coverRatio: string }> = {
  douyin: { label: '抖音', titleMax: 55, descriptionMax: 220, tagsMax: 8, coverRatio: '9:16' },
  bilibili: { label: 'B站', titleMax: 60, descriptionMax: 1000, tagsMax: 12, coverRatio: '16:9' },
};

@Injectable()
export class ContentService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase) {}

  async createMasterContent(userId: string, input: {
    title: string;
    body?: string;
    mediaReferences?: string[];
    coverReference?: string;
    tags?: string[];
    sourceType: 'manual' | 'internal' | 'test';
  }) {
    const now = new Date();
    const id = newId();
    await this.db.insert(masterContents).values({
      id,
      userId,
      title: input.title,
      body: input.body ?? null,
      mediaReferencesJson: input.mediaReferences ?? [],
      coverReference: input.coverReference ?? null,
      tagsJson: input.tags ?? [],
      sourceType: input.sourceType,
      createdAt: now,
      updatedAt: now,
    });
    return this.getMasterContentById(userId, id);
  }

  async listMasterContents(userId: string) {
    const rows = await this.db.select().from(masterContents)
      .where(eq(masterContents.userId, userId))
      .orderBy(desc(masterContents.createdAt));
    return rows.map((row) => this.masterContentResponse(row));
  }

  async listPlatformVariants(userId: string, filters: { masterContentId?: string; platform?: ContentPlatform }) {
    const conditions = [eq(platformVariants.userId, userId)];
    if (filters.masterContentId) conditions.push(eq(platformVariants.masterContentId, filters.masterContentId));
    if (filters.platform) conditions.push(eq(platformVariants.platform, filters.platform));
    const rows = await this.db.select().from(platformVariants)
      .where(and(...conditions))
      .orderBy(desc(platformVariants.createdAt));
    return rows.map((row) => this.platformVariantResponse(row));
  }

  async resolveInternal(userId: string, config: Record<string, unknown>, context: ContentContext) {
    const current = this.normalizeMasterContent(context.masterContent ?? context);
    const targetPlatforms = this.readTargetPlatforms(config.targetPlatforms ?? context.targetPlatforms);
    if (current) {
      return this.enrichContext({ ...context, masterContent: current, targetPlatforms });
    }
    if (typeof config.masterContentId !== 'string') return context;
    const masterContent = await this.getMasterContentById(userId, config.masterContentId);
    if (!masterContent) return context;
    return this.enrichContext({ ...context, masterContent, targetPlatforms });
  }

  enrichContext(context: ContentContext) {
    const masterContent = this.normalizeMasterContent(context.masterContent ?? context);
    if (!masterContent) return context;
    return {
      ...context,
      masterContent,
      masterContentId: masterContent.id ?? context.masterContentId ?? null,
      contentTitle: masterContent.title,
      contentBody: masterContent.body,
      mediaReferences: masterContent.mediaReferences,
      coverReference: masterContent.coverReference,
      contentTags: masterContent.tags,
      targetPlatforms: this.readTargetPlatforms(context.targetPlatforms),
    };
  }

  generatePlatformVariants(context: ContentContext, config: Record<string, unknown>) {
    const enriched = this.enrichContext(context);
    const masterContent = this.normalizeMasterContent(enriched.masterContent);
    if (!masterContent) return [];
    const targetPlatforms = this.readTargetPlatforms(config.targetPlatforms ?? enriched.targetPlatforms);
    const generateTitle = config.generateTitle !== false;
    const generateDescription = config.generateDescription !== false;
    const generateTags = config.generateTags !== false;
    return targetPlatforms.map((platform) => {
      const rule = PLATFORM_RULES[platform];
      const baseTitle = generateTitle
        ? this.fitText(masterContent.title, rule.titleMax)
        : masterContent.title;
      const descriptionSource = masterContent.body ?? masterContent.title;
      const baseDescription = generateDescription
        ? this.fitText(descriptionSource, rule.descriptionMax)
        : descriptionSource;
      const baseTags = generateTags
        ? masterContent.tags.slice(0, rule.tagsMax)
        : [...masterContent.tags];
      const issues: string[] = [];
      if (!baseTitle.trim()) issues.push(`${rule.label}版本标题不能为空。`);
      if (baseTitle.length > rule.titleMax) issues.push(`${rule.label}版本标题超出限制，等待你修改。`);
      if (baseDescription.length > rule.descriptionMax) issues.push(`${rule.label}版本描述超出限制，等待你修改。`);
      if (baseTags.length > rule.tagsMax) issues.push(`${rule.label}版本标签数量超出限制，等待你修改。`);
      if (!masterContent.coverReference) issues.push(`${rule.label}版本封面尚未准备好。`);
      return {
        platform,
        title: baseTitle,
        description: baseDescription,
        tags: baseTags,
        coverRequirements: `${rule.coverRatio} 封面`,
        publishStatus: issues.length === 0 ? 'draft_ready' : 'needs_revision',
        validationResult: {
          valid: issues.length === 0,
          issues,
          titleLength: baseTitle.length,
          descriptionLength: baseDescription.length,
          tagCount: baseTags.length,
        },
      } satisfies GeneratedPlatformVariant;
    });
  }

  async createDraftVariants(userId: string, masterContentId: string, variants: Array<{
    platform: string;
    title: string;
    description: string;
    tags: string[];
    coverRequirements: string;
    publishStatus: string;
    validationResult: {
      valid: boolean;
      issues: string[];
      titleLength: number;
      descriptionLength: number;
      tagCount: number;
    };
  }>) {
    const now = new Date();
    const rows = variants.map((variant) => ({
      id: newId(),
      userId,
      masterContentId,
      platform: variant.platform,
      title: variant.title,
      description: variant.description,
      tagsJson: variant.tags,
      coverRequirements: variant.coverRequirements,
      publishStatus: variant.publishStatus,
      validationResultJson: variant.validationResult,
      createdAt: now,
      updatedAt: now,
    }));
    await this.db.insert(platformVariants).values(rows);
    return rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      title: row.title,
      publishStatus: row.publishStatus,
      validationResult: row.validationResultJson,
    }));
  }

  async prepareVariants(userId: string, variantIds: string[]) {
    if (variantIds.length === 0) return [];
    const rows = await this.db.select().from(platformVariants)
      .where(and(eq(platformVariants.userId, userId), inArray(platformVariants.id, variantIds)))
      .orderBy(desc(platformVariants.createdAt));
    for (const row of rows) {
      const valid = Boolean((row.validationResultJson as { valid?: unknown })?.valid);
      await this.db.update(platformVariants)
        .set({ publishStatus: valid ? 'prepared' : 'needs_revision', updatedAt: new Date() })
        .where(eq(platformVariants.id, row.id));
    }
    const updated = await this.db.select().from(platformVariants)
      .where(and(eq(platformVariants.userId, userId), inArray(platformVariants.id, variantIds)))
      .orderBy(desc(platformVariants.createdAt));
    return updated.map((row) => this.platformVariantResponse(row));
  }

  platformLabel(platform: string) {
    return PLATFORM_RULES[platform as ContentPlatform]?.label ?? platform;
  }

  private async getMasterContentById(userId: string, id: string) {
    const row = (await this.db.select().from(masterContents)
      .where(and(eq(masterContents.userId, userId), eq(masterContents.id, id)))
      .limit(1))[0];
    return row ? this.masterContentResponse(row) : null;
  }

  private readTargetPlatforms(value: unknown): ContentPlatform[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ContentPlatform => typeof item === 'string' && CONTENT_PLATFORMS.includes(item as ContentPlatform));
  }

  private normalizeMasterContent(value: unknown): MasterContentShape | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const mediaReferences = Array.isArray(row.mediaReferences)
      ? row.mediaReferences.filter((item): item is string => typeof item === 'string')
      : Array.isArray(row.mediaReferencesJson)
        ? row.mediaReferencesJson.filter((item): item is string => typeof item === 'string')
        : [];
    const tags = Array.isArray(row.tags)
      ? row.tags.filter((item): item is string => typeof item === 'string')
      : Array.isArray(row.tagsJson)
        ? row.tagsJson.filter((item): item is string => typeof item === 'string')
        : [];
    if (typeof row.title !== 'string') return null;
    return {
      id: typeof row.id === 'string' ? row.id : undefined,
      title: row.title,
      body: typeof row.body === 'string' ? row.body : null,
      mediaReferences,
      coverReference: typeof row.coverReference === 'string' ? row.coverReference : null,
      tags,
      sourceType: typeof row.sourceType === 'string' ? row.sourceType : 'internal',
    };
  }

  private fitText(value: string, max: number) {
    return value.length > max ? value.slice(0, max) : value;
  }

  private masterContentResponse(row: typeof masterContents.$inferSelect) {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      mediaReferences: row.mediaReferencesJson,
      coverReference: row.coverReference,
      tags: row.tagsJson,
      sourceType: row.sourceType,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private platformVariantResponse(row: typeof platformVariants.$inferSelect) {
    return {
      id: row.id,
      masterContentId: row.masterContentId,
      platform: row.platform,
      title: row.title,
      description: row.description,
      tags: row.tagsJson,
      coverRequirements: row.coverRequirements,
      publishStatus: row.publishStatus,
      validationResult: row.validationResultJson,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
