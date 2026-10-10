import { describe, expect, it } from 'vitest';
import { githubTrending } from '../src/connectors/github-trending';
import { PublicWebConnector, WEB_READ } from '../src/connectors/public-web.connector';
import { githubDigestPlan, isGithubDigestDefinition, normalizePlanDefinition } from '@lazy-armor/plan-schema';
const html = (count = 10) => '<title>Trending repositories on GitHub today · GitHub</title>' + Array.from({ length: count }, (_, i) => `<article class="Box-row"><h2><a href="/owner/project-${i}">owner / project-${i}</a></h2><p>示例项目描述</p><span itemprop="programmingLanguage">TypeScript</span><a href="/owner/project-${i}/stargazers">1,234</a><span class="float-sm-right">123 stars today</span></article>`).join('');
describe('fixed GitHub daily public reader', () => {
  it('retains actual page order, metadata and source hash', () => {
    const data = githubTrending(html()); expect(data.repositories).toHaveLength(10);
    expect(data.repositories[0]).toMatchObject({ rank: 1, fullName: 'owner/project-0', url: 'https://github.com/owner/project-0', stars: 1234, todayStars: 123 });
    expect(data.repositories[9]?.rank).toBe(10); expect(data.sha256).toHaveLength(64); expect(data.verification).toBe('SOURCE_RESPONSE_ONLY');
  });
  it('fails closed on incomplete, duplicate, challenge and malicious repository href', () => {
    for (const raw of [html(9), html().replace('/owner/project-1', '/owner/project-0'), '<title>Security check</title>' + html().replace(/<title>.*?<\/title>/, ''), html().replace('/owner/project-0', '//evil.test/inject')]) expect(() => githubTrending(raw)).toThrow();
  });
  it('does not invent absent counts or language', () => {
    const data = githubTrending(html().replace(/<span[^>]*>.*?<\/span>/g, '').replace(/1,234/g, 'unavailable'));
    expect(data.repositories[0]).toMatchObject({ language: null, stars: null, todayStars: null });
  });
  it('rejects another website scope before any network read', async () => {
    await expect(new PublicWebConnector().read({ capability: WEB_READ, requestId: 'isolated', credentials: { data: { entryUrls: 'https://www.jingmen.gov.cn/' } }, input: { mode: 'github_trending_daily' } })).rejects.toMatchObject({ code: 'WEB_SCOPE_DENIED' });
  });
  it('normalizes the frozen daily plan and rejects source overrides', () => {
    const plan = githubDigestPlan('11111111-1111-4111-8111-111111111111'); expect(isGithubDigestDefinition(normalizePlanDefinition(plan))).toBe(true);
    expect(() => normalizePlanDefinition({ ...plan, sources: [{ ...plan.sources[0]!, config: { mode: 'github_trending_daily', url: 'https://evil.test' } }] })).toThrow();
  });
});
