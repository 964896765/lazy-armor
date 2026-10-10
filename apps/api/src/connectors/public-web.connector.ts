import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { z } from 'zod';
import { ConnectorError, type Connector, type ConnectorRequest, type ConnectorResult } from '@lazy-armor/connector-sdk';
import { publicWebUrl, readPublicWeb } from './public-web-reader';
import { GITHUB_TRENDING_URL } from '@lazy-armor/plan-schema';
import { githubTrending } from './github-trending';

export const WEB_READ = 'READ_PUBLIC_WEB_RESEARCH';
const inputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('github_trending_daily') }).strict(),
  z.object({ mode: z.literal('search'), query: z.string().trim().min(2).max(250) }).strict(),
  z.object({ mode: z.literal('page'), url: z.string().max(2000) }).strict(),
]);
export function publicWebConfig(data?: Record<string, string>) {
  if (!data || Object.keys(data).some(k => k !== 'entryUrls') || typeof data.entryUrls !== 'string') throw new ConnectorError('INVALID_ENDPOINT', 'INVALID_REQUEST', '请配置公开网站入口');
  const entries = [...new Set(data.entryUrls.split(/[\n,]+/).map(s => s.trim()).filter(Boolean))].map(s => publicWebUrl(s).href);
  if (!entries.length || entries.length > 3) throw new ConnectorError('INVALID_ENDPOINT', 'INVALID_REQUEST', '支持一至三个 HTTPS 网站入口');
  return { entries, origins: [...new Set(entries.map(s => new URL(s).origin))] };
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
export function webPage(raw: string, url: string) {
  const $ = load(raw);
  $('script,style,noscript,nav,footer,form,svg,iframe').remove();
  const title = clean($('meta[property="og:title"]').attr('content') || $('title').text() || $('h1').first().text()).slice(0, 180);
  const date = $('meta[name="PubDate"],meta[name="pubdate"],meta[name="publishdate"],meta[property="article:published_time"],meta[name="DC.date.issued"]').first().attr('content') || $('time[datetime]').first().attr('datetime') || null;
  const main = $('article,#zoom,.TRS_Editor,.article-content,.content_detail,main').first();
  const text = clean(main.length ? main.text() : $('body').text());
  if (/verify you are human|验证码|安全验证|访问过于频繁|captcha/i.test(title)) throw new ConnectorError('INVALID_WEB_RESPONSE', 'PROVIDER_UNAVAILABLE', '网页需要人工验证');
  // A valid but empty/list response is an unusable document, not a provider outage.
  if (text.length < 100) throw new ConnectorError('WEB_TEXT_INSUFFICIENT', 'INVALID_REQUEST', '该网页正文不足，不能作为报告原文');
  const excerpt = text.slice(0, 10000);
  return { title: title || new URL(url).hostname, url, publishedAt: date?.slice(0, 100) ?? null, excerpt,
    truncated: text.length > excerpt.length, sha256: createHash('sha256').update(excerpt).digest('hex'), retrievedAt: new Date().toISOString(), verification: 'SOURCE_RESPONSE_ONLY' as const };
}
export function webLinks(raw: string, base: string, origins: string[]) {
  const $ = load(raw), candidates: Array<{ title: string; url: string; method: 'SEARCH_RESULT' | 'AUTHORIZED_SITE_DISCOVERY' }> = [];
  $('a[href]').each((_i, a) => {
    const title = clean($(a).text()).slice(0, 180); let href = $(a).attr('href')!;
    try {
      let url = new URL(href, base);
      // Decode the target only; never request a Bing tracking redirect.
      if (url.hostname === 'www.bing.com' && url.pathname === '/ck/a') {
        const encoded = url.searchParams.get('u'); if (!encoded?.startsWith('a1')) return;
        href = Buffer.from(encoded.slice(2), 'base64url').toString('utf8'); url = new URL(href);
      }
      url.hash = ''; publicWebUrl(url.href);
      if (!origins.includes(url.origin) || title.length < 4 || /\.(pdf|docx?|xlsx?|zip|png|jpg)(?:$|\?)/i.test(url.href)) return;
      if (!candidates.some(c => c.url === url.href)) candidates.push({ title, url: url.href, method: new URL(base).hostname === 'www.bing.com' ? 'SEARCH_RESULT' : 'AUTHORIZED_SITE_DISCOVERY' });
    } catch { /* Unreadable or out-of-scope links are not candidates. */ }
  });
  return candidates;
}

/** Public text retrieval only, constrained to saved exact origins. */
export class PublicWebConnector implements Connector {
  metadata = () => ({ key: 'public_web_research', name: '公开网页检索', description: '在确认的网站范围内搜索并读取公开正文', version: '1.0.0', connectorSdkVersion: '0.1.0', providerType: 'file' as const,
    productionStatus: 'BETA' as const, authentication: { type: 'none' as const }, supportsRefresh: false, supportsRevoke: true, supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'none' as const, rateLimitStrategy: 'unknown' as const });
  capabilities = () => [{ key: WEB_READ, name: '检索并读取公开网页', operation: 'read' as const, riskLevel: 'R0' as const, requiredPermission: WEB_READ, providerAvailability: 'beta' as const }];
  async validateConnection(input: ConnectorRequest) {
    try { const config = publicWebConfig(input.credentials?.data); const html = await readPublicWeb(config.entries[0]!); webPage(html, config.entries[0]!);
      const now = new Date(); return { status: 'healthy' as const, checkedAt: now.toISOString(), validUntil: new Date(now.getTime() + 300000).toISOString() }; }
    catch { return { status: 'unhealthy' as const, checkedAt: new Date().toISOString(), reason: 'PUBLIC_WEB_UNREACHABLE' }; }
  }
  async read(request: ConnectorRequest): Promise<ConnectorResult> {
    const parsed = inputSchema.safeParse(request.input);
    if (request.capability !== WEB_READ || !parsed.success) throw new ConnectorError('INVALID_READ_INPUT', 'INVALID_REQUEST', '只接受公开网页查询或范围内正文读取');
    const config = publicWebConfig(request.credentials?.data), input = parsed.data;
    if (input.mode === 'github_trending_daily') {
      if (!config.origins.includes('https://github.com')) throw new ConnectorError('WEB_SCOPE_DENIED', 'PERMISSION_DENIED', 'GitHub 不在确认的网站范围内');
      return { ok: true, data: { githubTrending: githubTrending(await readPublicWeb(GITHUB_TRENDING_URL)) } };
    }
    if (input.mode === 'page') {
      const url = publicWebUrl(input.url);
      if (!config.origins.includes(url.origin)) throw new ConnectorError('WEB_SCOPE_DENIED', 'PERMISSION_DENIED', '网页不在确认的网站范围内');
      return { ok: true, data: { page: webPage(await readPublicWeb(url.href), url.href) } };
    }
    const candidates: ReturnType<typeof webLinks> = [], warnings: string[] = [];
    const search = new URL('https://www.bing.com/search');
    search.searchParams.set('q', input.query + ' (' + config.origins.map(s => 'site:' + new URL(s).hostname).join(' OR ') + ')');
    search.searchParams.set('setlang', 'zh-hans');
    try { candidates.push(...webLinks(await readPublicWeb(search.href), search.href, config.origins)); }
    catch { warnings.push('搜索服务当前不可读取'); }
    // Site discovery is a separately labelled fallback, never fabricated search hits.
    for (const entry of config.entries) {
      try { const html = await readPublicWeb(entry); candidates.push({ title: webPage(html, entry).title, url: entry, method: 'AUTHORIZED_SITE_DISCOVERY' }, ...webLinks(html, entry, config.origins)); }
      catch { warnings.push('一个已确认的网站入口当前不可读取'); }
    }
    const terms = input.query.match(/[\p{Script=Han}]{2,}|[a-z0-9]{3,}/giu) ?? [];
    const score = (title: string) => terms.filter(t => title.includes(t)).length * 5 + (/统计|公报|数据|经济|排水|许可|环保/.test(title) ? 2 : 0);
    const unique = [...new Map(candidates.map(c => [c.url, c])).values()].sort((a, b) => score(b.title) - score(a.title)).slice(0, 40);
    if (!unique.some(c => c.method === 'SEARCH_RESULT')) warnings.push('搜索服务未返回范围内结果，候选来自实际读取的网站入口');
    return { ok: true, data: { query: input.query, scope: config.origins, candidates: unique, warnings, retrievedAt: new Date().toISOString(), verification: 'SOURCE_RESPONSE_ONLY' } };
  }
  async revoke() {}
}
