import { z } from 'zod';
import type { PlanDefinitionInput } from './index';

export const GITHUB_TRENDING_URL = 'https://github.com/trending?since=daily';
export const githubTrendingSchema = z.object({
  url: z.literal(GITHUB_TRENDING_URL), since: z.literal('daily'), language: z.literal('all'),
  retrievedAt: z.iso.datetime(), sha256: z.string().regex(/^[a-f0-9]{64}$/), verification: z.literal('SOURCE_RESPONSE_ONLY'),
  repositories: z.array(z.object({
    rank: z.number().int().min(1).max(10), fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(180),
    url: z.string().url().max(220), description: z.string().max(180), language: z.string().max(50).nullable(),
    stars: z.number().int().min(0).nullable(), todayStars: z.number().int().min(0).nullable(),
  }).strict()).length(10),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.repositories.map(r => r.fullName.toLowerCase())).size !== 10 || data.repositories.some((r, i) => r.rank !== i + 1 || r.url !== `https://github.com/${r.fullName}`))
    ctx.addIssue({ code: 'custom', message: 'GITHUB_TRENDING_ORDER_INVALID' });
});
export type GithubTrending = z.infer<typeof githubTrendingSchema>;
export const githubDigestSchema = z.object({
  source: githubTrendingSchema, prompt: z.string().min(100).max(850), modelId: z.string().max(100),
  overview: z.string().min(10).max(220),
  items: z.array(z.object({ fullName: z.string().max(180), summary: z.string().min(5).max(100), previousRank: z.number().int().min(1).max(10).nullable() }).strict()).length(10),
  baselineAt: z.iso.datetime().nullable(),
}).strict().superRefine((digest, ctx) => {
  if (digest.items.some((item, i) => item.fullName !== digest.source.repositories[i]?.fullName)) ctx.addIssue({ code: 'custom', message: 'GITHUB_DIGEST_ORDER_INVALID' });
});
export type GithubDigest = z.infer<typeof githubDigestSchema>;
export function githubDigestPlan(connectionId: string): PlanDefinitionInput {
  return { name: '每天 GitHub 前 10 动态汇总', domain: 'general', automationLevel: 'L2',
    description: 'GitHub 公开 Trending 日榜，所有语言，前 10。每天北京时间 09:00 读取当前榜单，由 AI 自动生成提示词和中文摘要；与上次成功汇总比较名次。站内通知，可暂停。',
    sources: [{ sourceType: 'file', connectorKey: 'public_web_research', connectionId, config: { mode: 'github_trending_daily' }, sortOrder: 0 }],
    triggers: [{ triggerType: 'schedule', config: { cronExpression: '0 9 * * *', timezone: 'Asia/Shanghai' }, sortOrder: 0 }], conditions: [],
    actions: [{ actionType: 'summarize', config: { domain: 'github', summaryType: 'trending-daily' }, stepOrder: 0 },
      { actionType: 'notify', config: { channel: 'in_app', eventType: 'github_trending_digest', priority: 'P2' }, stepOrder: 1 }],
  };
}
export function isGithubDigestDefinition(definition: { sources: readonly { sourceType: string; connectorKey?: string | null; connectionId?: string | null; config: Record<string, unknown> }[]; actions: readonly { actionType: string; connectionId?: string | null; config: Record<string, unknown> }[]; triggers: readonly { triggerType: string; config: Record<string, unknown> }[]; conditions: readonly unknown[] }) {
  const [source] = definition.sources, [summary, notify] = definition.actions;
  return definition.sources.length === 1 && source?.sourceType === 'file' && source.connectorKey === 'public_web_research' && Boolean(source.connectionId)
    && source.config.mode === 'github_trending_daily' && definition.actions.length === 2
    && summary?.actionType === 'summarize' && !summary.connectionId && summary.config.domain === 'github' && summary.config.summaryType === 'trending-daily'
    && notify?.actionType === 'notify' && !notify.connectionId && notify.config.channel === 'in_app' && notify.config.eventType === 'github_trending_digest'
    && definition.conditions.length === 0 && definition.triggers.length === 1 && definition.triggers[0]?.triggerType === 'schedule'
    && definition.triggers[0]?.config.cronExpression === '0 9 * * *' && definition.triggers[0]?.config.timezone === 'Asia/Shanghai';
}
