import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { PublicJsonConnector, publicAddress, publicJsonUrl } from '../src/connectors/public-json.connector';

afterEach(() => vi.resetAllMocks());
const input = { capability: 'READ_PUBLIC_HTTP_JSON', requestId: 'test', input: {}, credentials: { data: { endpoint: 'https://example.com/data.json' } } };
function response(statusCode: number, body: string) {
 mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
 mocks.request.mockImplementation((_url, options, callback) => {
  expect(options.agent).toBe(false); expect(options.family).toBe(4);
  options.lookup('example.com', {}, (error: unknown, address: string) => { expect(error).toBeNull(); expect(address).toBe('93.184.216.34'); });
  const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error?: Error) => void };
  req.destroy = error => { if (error) req.emit('error', error); req.emit('close'); };
  req.end = () => { const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: object; destroy: () => void }; res.statusCode = statusCode; res.headers = { 'content-type': 'application/json' }; res.destroy = () => {}; callback(res); res.emit('data', Buffer.from(body)); res.emit('end'); req.emit('close'); };
  return req;
 });
}
describe('bounded public JSON reads', () => {
 it('rejects operation parameters and unknown capabilities before network access', async () => {
  await expect(new PublicJsonConnector().read({ ...input, input: { endpoint: 'https://other.example/data' } })).rejects.toThrow('额外操作参数');
  await expect(new PublicJsonConnector().read({ ...input, capability: 'WRITE_PUBLIC_HTTP_JSON' })).rejects.toThrow('额外操作参数');
  expect(mocks.lookup).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
 });
 it('rejects local, reserved, mapped and private network addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.1.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) expect(publicAddress(address)).toBe(false);
  expect(publicAddress('93.184.216.34')).toBe(true);
 });
 it('rejects HTTP, credentials, arbitrary ports and query secrets', () => {
  for (const url of ['http://example.com/data', 'https://user:password@example.com/data', 'https://example.com:8443/data', 'https://example.com/data?key=secret', 'https://127.0.0.1/data']) expect(() => publicJsonUrl(url)).toThrow();
 });
 it('rejects mixed DNS answers before sending traffic', async () => {
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]);
  await expect(new PublicJsonConnector().read(input)).rejects.toThrow('私有网络'); expect(mocks.request).not.toHaveBeenCalled();
 });
 it('pins a public DNS answer and labels JSON as source evidence', async () => {
  response(200, '{"amount":42}'); const result = await new PublicJsonConnector().read(input);
  expect(result.data.value).toEqual({ amount: 42 }); expect(result.data.verification).toBe('SOURCE_RESPONSE_ONLY');
 });
 it('does not follow redirects or accept oversized JSON', async () => {
  response(302, '{}'); await expect(new PublicJsonConnector().read(input)).rejects.toThrow('接口未返回');
  response(200, 'x'.repeat(128001)); await expect(new PublicJsonConnector().read(input)).rejects.toThrow('128 KB');
 });
});
