import { afterEach, describe, expect, it, vi } from 'vitest';
const network = vi.hoisted(() => vi.fn());
vi.mock('../src/connectors/public-web-reader', async original => ({ ...await original<typeof import('../src/connectors/public-web-reader')>(), readPublicWeb: network }));
import { PublicWebConnector, WEB_READ, publicWebConfig, webPage } from '../src/connectors/public-web.connector';
const input = { capability: WEB_READ, requestId: 'isolated', input: { mode: 'search', query: '荆门 统计公报' }, credentials: { data: { entryUrls: 'https://www.example.gov.cn/' } } };
const html = `<html><head><title>统计公报</title><meta name="PubDate" content="2025-03-14"></head><body><script>恶意脚本</script><article>${'公开统计信息，仅为来源响应。'.repeat(30)}</article></body></html>`;
afterEach(() => vi.resetAllMocks());
describe('public web scope and evidence', () => {
  it('rejects local addresses, credentials and hidden configuration fields', () => {
    for (const entryUrls of ['http://example.gov.cn/', 'https://user:secret@example.gov.cn/', 'https://127.0.0.1/', 'https://[::ffff:127.0.0.1]/', 'https://example.gov.cn/?token=secret']) expect(() => publicWebConfig({ entryUrls })).toThrow();
    expect(() => publicWebConfig({ entryUrls: 'https://example.gov.cn/', key: 'secret' })).toThrow();
  });
  it('refuses out-of-scope hosts and subdomains before reading', async () => {
    for (const url of ['https://other.gov.cn/a', 'https://stats.example.gov.cn/a', 'https://www.example.gov.cn.attacker.com/a']) {
      await expect(new PublicWebConnector().read({ ...input, input: { mode: 'page', url } })).rejects.toThrow('范围');
    }
    expect(network).not.toHaveBeenCalled();
  });
  it('rejects write parameters and caller-supplied scope overrides', async () => {
    await expect(new PublicWebConnector().read({ ...input, input: { mode: 'search', query: '统计', origins: ['https://other.gov.cn'] } })).rejects.toThrow('只接受');
    await expect(new PublicWebConnector().read({ ...input, capability: 'WRITE_WEB_FORM' })).rejects.toThrow('只接受');
    expect(network).not.toHaveBeenCalled();
  });
  it('extracts only actual text with publication and retrieval times kept separate', async () => {
    network.mockResolvedValue(html);
    const result = await new PublicWebConnector().read({ ...input, input: { mode: 'page', url: 'https://www.example.gov.cn/report.html' } });
    expect(result.data.page).toMatchObject({ url: 'https://www.example.gov.cn/report.html', publishedAt: '2025-03-14', verification: 'SOURCE_RESPONSE_ONLY' });
    expect((result.data.page as { excerpt: string }).excerpt).not.toContain('恶意脚本');
    expect(webPage(html.replace('<meta name="PubDate" content="2025-03-14">', ''), 'https://www.example.gov.cn/').publishedAt).toBeNull();
  });
  it('decodes search targets without visiting tracking links and filters scope', async () => {
    const code = 'a1' + Buffer.from('https://www.example.gov.cn/report.html').toString('base64url');
    network.mockImplementation(async (url: string) => url.startsWith('https://www.bing.com/search?')
      ? `<html><body><h2><a href="https://www.bing.com/ck/a?u=${code}">地方统计公报</a></h2><a href="https://other.gov.cn/report.html">范围外政策</a></body></html>` : html);
    const data = (await new PublicWebConnector().read(input)).data as { candidates: Array<{ url: string; method: string }> };
    expect(data.candidates).toContainEqual({ title: '地方统计公报', url: 'https://www.example.gov.cn/report.html', method: 'SEARCH_RESULT' });
    expect(data.candidates.every(c => new URL(c.url).origin === 'https://www.example.gov.cn')).toBe(true);
    expect(network.mock.calls.some(([url]) => url.includes('/ck/a'))).toBe(false);
  });
  it('labels actual entry discovery separately when search fails', async () => {
    network.mockImplementation(async (url: string) => { if (url.startsWith('https://www.bing.com')) throw new Error('unavailable'); return html.replace('</body>', '<a href="/report.html">统计公报原文</a></body>'); });
    const data = (await new PublicWebConnector().read(input)).data as { candidates: Array<{ method: string }>; warnings: string[] };
    expect(data.candidates.every(c => c.method === 'AUTHORIZED_SITE_DISCOVERY')).toBe(true);
    expect(data.warnings).toContain('搜索服务未返回范围内结果，候选来自实际读取的网站入口');
  });
  it('bounds excerpts and rejects challenge pages rather than fabricating content', () => {
    expect(webPage(html.replace('</article>', '长'.repeat(15000) + '</article>'), 'https://www.example.gov.cn/')).toMatchObject({ truncated: true });
    expect(() => webPage('<title>安全验证</title><body>' + '验证'.repeat(100) + '</body>', 'https://www.example.gov.cn/')).toThrow();
  });
  it('distinguishes a short valid document from an unavailable provider', () => {
    expect(() => webPage('<title>统计栏目</title><body><main>暂无正文</main></body>', 'https://www.example.gov.cn/')).toThrow(expect.objectContaining({ code: 'WEB_TEXT_INSUFFICIENT', category: 'INVALID_REQUEST' }));
  });
});
