import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { ConnectorError } from '@lazy-armor/connector-sdk';
import { publicAddress } from './public-json.connector';

export function publicWebUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ConnectorError('INVALID_ENDPOINT', 'INVALID_REQUEST', '请输入公开 HTTPS 网页地址'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || url.href.length > 2000
    || host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !publicAddress(host))
    || [...url.searchParams.keys()].some(k => /token|secret|password|auth|api.?key/i.test(k))) {
    throw new ConnectorError('INVALID_ENDPOINT', 'INVALID_REQUEST', '仅支持无登录凭据的公开 HTTPS 网页');
  }
  return url;
}

/** Checked DNS is pinned for TLS. No cookies, JS, forms or redirect following. */
export async function readPublicWeb(raw: string): Promise<string> {
  const url = publicWebUrl(raw), host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ConnectorError('TIMEOUT', 'TIMEOUT', '网页地址解析超时')), 5000);
    lookup(host, { all: true }).then(resolve, reject).finally(() => clearTimeout(timer));
  });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new ConnectorError('PRIVATE_ENDPOINT', 'INVALID_REQUEST', '网页地址包含私有网络');
  // Some mobile/local networks resolve IPv6 but cannot route it. Prefer a checked
  // IPv4 answer, while still rejecting the entire response if any address is private.
  const pinned = addresses.find(a => a.family === 4) ?? addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', agent: false, family: pinned.family,
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (compatible; LazyArmorPublicResearch/1.0)', 'accept-encoding': 'identity' },
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
    }, res => {
      if (res.statusCode !== 200 || !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(res.headers['content-type'] ?? '') || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
        res.destroy(); reject(new ConnectorError('INVALID_WEB_RESPONSE', 'PROVIDER_UNAVAILABLE', '网页不可读取，未跟随跳转或执行页面脚本')); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1000000) { res.destroy(); reject(new ConnectorError('RESPONSE_TOO_LARGE', 'INVALID_REQUEST', '网页超过 1 MB')); }
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(res.headers['content-type'] ?? '')?.[1] ?? 'utf-8';
        try { resolve(new TextDecoder(charset, { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { reject(new ConnectorError('INVALID_WEB_ENCODING', 'PROVIDER_UNAVAILABLE', '网页编码无法解析')); }
      });
    });
    const timer = setTimeout(() => req.destroy(new ConnectorError('TIMEOUT', 'TIMEOUT', '网页读取超时')), 10000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end();
  });
}
