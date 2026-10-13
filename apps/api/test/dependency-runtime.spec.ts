import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';

// Resolve each transitive package through its real consumer rather than adding
// production dependencies merely to expose them to the test runner.
const apiRequire = createRequire(path.resolve('package.json'));
const mobileRequire = createRequire(path.resolve('../mobile/package.json'));
const adminRequire = createRequire(path.resolve('../admin/package.json'));
const expressRequire = createRequire(apiRequire.resolve('express'));
const expoRequire = createRequire(mobileRequire.resolve('expo/package.json'));
const cliRequire = createRequire(expoRequire.resolve('@expo/cli/package.json'));
const rnRequire = createRequire(mobileRequire.resolve('react-native/package.json'));
const devtoolsRequire = createRequire(rnRequire.resolve('react-devtools-core/package.json'));
const nextRequire = createRequire(adminRequire.resolve('next/package.json'));
const postcssRequire = createRequire(nextRequire.resolve('postcss'));
const proxyaddr = expressRequire('proxy-addr');
const shellQuote = devtoolsRequire('shell-quote');
const { SourceMapConsumer, SourceMapGenerator } = postcssRequire('source-map-js');
const compression = cliRequire('compression');

describe('patched production dependency behavior', () => {
  it('preserves correct IPv4 and IPv4-mapped IPv6 proxy trust', () => {
    for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
      const trust = proxyaddr.compile(subnet);
      expect(trust('10.1.2.3', 0)).toBe(true);
      expect(trust('::ffff:10.1.2.3', 0)).toBe(true);
      expect(trust('203.0.113.5', 0)).toBe(false);
    }
  });

  it.each(['::ffff:10.0.0.0/8', '::/1'])('does not trust an arbitrary IPv4 peer for misconfigured subnet %s', subnet => {
    const peer = '203.0.113.5';
    const req = { socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': '127.0.0.1' } };
    expect(proxyaddr(req, proxyaddr.compile(subnet))).toBe(peer);
  });

  it('preserves Express forwarded IP behavior only for a trusted peer', async () => {
    const app = express();
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    app.set('trust proxy', false);
    const untrusted = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.77').expect(200);
    expect(untrusted.body.ip).not.toBe('203.0.113.77');
    app.set('trust proxy', 'loopback');
    const trusted = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.77').expect(200);
    expect(trusted.body.ip).toBe('203.0.113.77');
  });

  it.each(['\n', '\r', '\u2028', '\u2029'])('rejects shell line terminators following a comment token (%j) without invoking a shell', newline => {
    expect(() => shellQuote.quote(['echo', 'safe', { comment: 'fixture' }, `a${newline}INJECTED_COMMAND;#`])).toThrow(TypeError);
  });

  it('preserves normal DevTools shell argument parsing', () => {
    expect(shellQuote.parse('code --wait "folder with spaces/file.ts"')).toEqual(['code', '--wait', 'folder with spaces/file.ts']);
    expect(shellQuote.parse(shellQuote.quote(['code', '--wait', 'folder with spaces/file.ts']))).toEqual(['code', '--wait', 'folder with spaces/file.ts']);
  });

  it('preserves indexed source maps with a bounded section offset', () => {
    const map = new SourceMapGenerator({ file: 'fixture.js' });
    map.addMapping({ generated: { line: 1, column: 0 }, original: { line: 1, column: 0 }, source: 'fixture.ts' });
    const consumer = new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 2, column: 0 }, map: map.toJSON() }] });
    expect(consumer.originalPositionFor({ line: 3, column: 1 })).toMatchObject({ source: 'fixture.ts', line: 1 });
  });

  it.each([Infinity, -1, 10_000_001])('rejects unsafe indexed source-map offsets (%s) before expanding mappings', line => {
    expect(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line, column: 0 }, map: { version: 3, sources: [], names: [], mappings: '' } }] })).toThrow();
  });

  it('round-trips a bounded gzip response through the Expo compression dependency', async () => {
    const app = express(); app.use(compression({ threshold: 0 }));
    app.get('/bundle', (_req, res) => res.type('text/plain').send('fixture-bundle '.repeat(300)));
    const response = await request(app).get('/bundle').set('Accept-Encoding', 'gzip').expect(200);
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.text).toBe('fixture-bundle '.repeat(300));
  });

  it('closes the native gzip stream after a real client aborts a compressed response', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(zlib, 'createGzip')!;
    let streams = 0, closed = 0;
    Object.defineProperty(zlib, 'createGzip', { ...descriptor, value: (...args: unknown[]) => {
      const stream = descriptor.value(...args); streams++;
      stream.once('close', () => { closed++; });
      return stream;
    } });
    const app = express(); app.use(compression({ threshold: 0 }));
    app.get('/bundle', (_req, res) => {
      res.type('text/plain').write('fixture-bundle '.repeat(300));
      (res as express.Response & { flush(): void }).flush();
      // Leave the response open, then let the client disconnect after gzip data.
    });
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>(resolve => server.once('listening', resolve));
      const port = (server.address() as AddressInfo).port;
      await new Promise<void>((resolve, reject) => {
        const call = get(`http://127.0.0.1:${port}/bundle`, { headers: { 'accept-encoding': 'gzip' } }, response => {
          response.once('data', () => { response.destroy(); resolve(); });
          response.once('error', reject);
        });
        call.once('error', reject);
      });
      await vi.waitFor(() => { expect(streams).toBe(1); expect(closed).toBe(1); }, { timeout: 2000, interval: 20 });
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      Object.defineProperty(zlib, 'createGzip', descriptor);
    }
  });

  it('preserves the native raster codec and bounded image transformation', async () => {
    const source = await sharp({ create: { width: 16, height: 8, channels: 3, background: '#407bff' } }).png().toBuffer();
    const result = await sharp(source, { limitInputPixels: 40_000_000 }).resize({ width: 8 }).jpeg().toBuffer();
    expect(await sharp(result).metadata()).toMatchObject({ format: 'jpeg', width: 8, height: 4 });
  });
});
