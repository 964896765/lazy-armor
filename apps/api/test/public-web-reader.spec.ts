import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { readPublicWeb } from '../src/connectors/public-web-reader';
afterEach(() => vi.resetAllMocks());
function response(status: number, body: string, type = 'text/html; charset=utf-8') {
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  mocks.request.mockImplementation((_url, options, callback) => {
    expect(options.headers['accept-encoding']).toBe('identity'); expect(options.headers.cookie).toBeUndefined(); expect(options.agent).toBe(false);
    options.lookup('example.com', {}, (_e: unknown, address: string) => expect(address).toBe('93.184.216.34'));
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (e: Error) => void };
    req.destroy = e => { req.emit('error', e); req.emit('close'); };
    req.end = () => { const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: object; destroy: () => void }; res.statusCode = status; res.headers = { 'content-type': type }; res.destroy = () => undefined; callback(res); res.emit('data', Buffer.from(body)); res.emit('end'); req.emit('close'); };
    return req;
  });
}
describe('public text transport', () => {
  it('rejects mixed private DNS without sending requests', async () => {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]);
    await expect(readPublicWeb('https://example.com/')).rejects.toThrow('私有网络'); expect(mocks.request).not.toHaveBeenCalled();
  });
  it('pins public DNS and preserves HTTPS host verification', async () => {
    response(200, '<html>公开信息</html>'); expect(await readPublicWeb('https://example.com/')).toContain('公开信息');
  });
  it('prefers checked IPv4 when DNS also exposes an unroutable IPv6 path', async () => {
    response(200, '<html>公开信息</html>');
    mocks.lookup.mockResolvedValue([{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }, { address: '93.184.216.34', family: 4 }]);
    expect(await readPublicWeb('https://example.com/')).toContain('公开信息');
    expect(mocks.request.mock.calls[0]![1].family).toBe(4);
  });
  it('does not follow redirects, accept PDFs, or exceed the byte limit', async () => {
    response(302, ''); await expect(readPublicWeb('https://example.com/')).rejects.toThrow('未跟随');
    response(200, '%PDF', 'application/pdf'); await expect(readPublicWeb('https://example.com/')).rejects.toThrow('不可读取');
    response(200, 'x'.repeat(1000001)); await expect(readPublicWeb('https://example.com/')).rejects.toThrow('1 MB');
  });
});
