import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { ConnectorError } from '@lazy-armor/connector-sdk';
import { GITHUB_TRENDING_URL, githubTrendingSchema } from '@lazy-armor/plan-schema';

export function githubTrending(raw: string, retrievedAt = new Date().toISOString()) {
  const $ = load(raw), clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  const title = clean($('title').text());
  if (!/Trending/i.test(title) || /captcha|verify you are human|security check/i.test(title)) throw new ConnectorError('GITHUB_TRENDING_UNREADABLE', 'PROVIDER_UNAVAILABLE', 'GitHub 日榜当前不可读取');
  const count = (value: string) => /^\d[\d,]*$/.test(clean(value)) ? Number(clean(value).replace(/,/g, '')) : null;
  const repositories = $('article.Box-row').slice(0, 10).toArray().map((row, index) => {
    const article = $(row), href = article.find('h2 a[href]').first().attr('href') ?? '';
    if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(href)) throw new ConnectorError('GITHUB_TRENDING_REPOSITORY_INVALID', 'PROVIDER_UNAVAILABLE', '榜单仓库地址格式已变化');
    const fullName = href.slice(1);
    const today = clean(article.find('span.float-sm-right').text()).match(/^([\d,]+) stars today$/);
    return { rank: index + 1, fullName, url: 'https://github.com' + href,
      description: clean(article.find('p').first().text()).slice(0, 180), language: clean(article.find('[itemprop="programmingLanguage"]').text()).slice(0, 50) || null,
      stars: count(article.find(`a[href="${href}/stargazers"]`).text()), todayStars: today ? count(today[1]!) : null };
  });
  const parsed = githubTrendingSchema.safeParse({ url: GITHUB_TRENDING_URL, since: 'daily', language: 'all', repositories, retrievedAt,
    sha256: createHash('sha256').update(raw).digest('hex'), verification: 'SOURCE_RESPONSE_ONLY' });
  if (!parsed.success) throw new ConnectorError('GITHUB_TRENDING_INCOMPLETE', 'PROVIDER_UNAVAILABLE', 'GitHub 日榜不足十项或页面结构已变化');
  return parsed.data;
}
