import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { ConnectorError, type Connector, type ConnectorRequest, type ConnectorResult } from '@lazy-armor/connector-sdk';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix, 'ipv4');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
export function publicAddress(address: string) {
  if (isIP(address) === 4) return !blocked.check(address, 'ipv4');
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6');
}
export function publicJsonUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ConnectorError('INVALID_ENDPOINT', 'INVALID_REQUEST', '请输入公开 HTTPS JSON 地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || url.search || url.href.length > 2000) throw new ConnectorError('INVALID_ENDPOINT', 'INVALID_REQUEST', '仅支持无密钥、无查询参数的公开 HTTPS JSON 地址');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !publicAddress(host))) throw new ConnectorError('PRIVATE_ENDPOINT', 'INVALID_REQUEST', '不能连接本地或私有网络地址');
  return url;
}

/** A bounded read adapter in the existing Connection authority; it exposes no write operation. */
export class PublicJsonConnector implements Connector {
  metadata = () => ({ key: 'public_http_json', name: '公开 JSON 接口', description: '读取无需密钥的公开 HTTPS JSON 数据', version: '1.0.0', connectorSdkVersion: '0.1.0', providerType: 'file' as const, productionStatus: 'BETA' as const, authentication: { type: 'none' as const }, supportsRefresh: false, supportsRevoke: true, supportsWebhook: false, supportsHealthCheck: true, sandboxSupport: 'none' as const, rateLimitStrategy: 'unknown' as const });
  capabilities = () => [{ key: 'READ_PUBLIC_HTTP_JSON', name: '读取公开 JSON', riskLevel: 'R0' as const, operation: 'read' as const, requiredPermission: 'READ_PUBLIC_HTTP_JSON', providerAvailability: 'beta' as const }];
  async validateConnection(request: ConnectorRequest) {
    try { await this.read({ ...request, capability: 'READ_PUBLIC_HTTP_JSON', input: {} }); const now = new Date(); return { status: 'healthy' as const, checkedAt: now.toISOString(), validUntil: new Date(now.getTime() + 300000).toISOString() }; }
    catch { return { status: 'unhealthy' as const, checkedAt: new Date().toISOString(), reason: 'PUBLIC_JSON_UNREACHABLE' }; }
  }
  async read(input: ConnectorRequest): Promise<ConnectorResult> {
    if (input.capability !== 'READ_PUBLIC_HTTP_JSON' || Object.keys(input.input).length) throw new ConnectorError('INVALID_READ_INPUT', 'INVALID_REQUEST', '此接口只读取已保存地址，不接受额外操作参数');
    const url = publicJsonUrl(input.credentials?.data?.endpoint ?? '');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ConnectorError('TIMEOUT', 'TIMEOUT', '接口解析超时')), 5000);
      lookup(host, { all: true }).then(resolve, reject).finally(() => clearTimeout(timer));
    });
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new ConnectorError('PRIVATE_ENDPOINT', 'INVALID_REQUEST', '地址解析包含私有网络');
    const pinned = addresses[0];
    const value = await new Promise<unknown>((resolve, reject) => {
      // Pin the checked DNS result, retain TLS host verification, and never follow redirects.
      const req = httpsRequest(url, { method: 'GET', headers: { accept: 'application/json' }, lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family), agent: false, family: pinned.family }, response => {
        if (response.statusCode !== 200 || !/^(application\/json|application\/[a-z0-9.+-]+\+json)(;|$)/i.test(response.headers['content-type'] ?? '')) { response.destroy(); reject(new ConnectorError('INVALID_JSON_RESPONSE', 'PROVIDER_UNAVAILABLE', '接口未返回 JSON 数据')); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 128000) { response.destroy(); reject(new ConnectorError('RESPONSE_TOO_LARGE', 'INVALID_REQUEST', '接口数据超过 128 KB')); } else chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new ConnectorError('INVALID_JSON_RESPONSE', 'PROVIDER_UNAVAILABLE', 'JSON 格式无效')); } });
      });
      const deadline = setTimeout(() => req.destroy(new ConnectorError('TIMEOUT', 'TIMEOUT', '接口读取超时')), 5000);
      req.on('close', () => clearTimeout(deadline)); req.on('error', reject); req.end();
    });
    return { ok: true, data: { value, sourceType: 'PUBLIC_HTTP_JSON', retrievedAt: new Date().toISOString(), verification: 'SOURCE_RESPONSE_ONLY' } };
  }
  async revoke() {}
}
