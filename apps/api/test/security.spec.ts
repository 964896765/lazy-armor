import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('credential-safe logging', () => {
  it('redacts tokens, passwords, API keys and nested secrets', async () => {
    const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { SafeLoggerService } = await import('../dist/common/safe-logger.service.js');
    const logger = new SafeLoggerService(sink);
    logger.log({ password: 'p', nested: { accessToken: 't', api_key: 'k' }, safe: 'visible' });
    const output = JSON.stringify(sink.log.mock.calls);
    expect(output).not.toContain('"p"');
    expect(output).not.toContain('"t"');
    expect(output).not.toContain('"k"');
    expect(output).toContain('visible');
    expect(output).toContain('[REDACTED]');
  });

  it('stores local development credentials as AES-GCM ciphertext', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lazy-armor-credential-test-'));
    try {
      const { LocalEncryptedCredentialProvider } = await import('../dist/credentials/local-encrypted-credential.provider.js');
      const values: Record<string, string> = {
        CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
        CREDENTIAL_STORE_PATH: directory,
      };
      const provider = new LocalEncryptedCredentialProvider({ getOrThrow: (key: string) => values[key] } as never);
      const ref = await provider.set({ accessToken: 'plaintext-must-not-appear' });
      const [filename] = await readdir(directory);
      const stored = await readFile(path.join(directory, filename!), 'utf8');
      expect(stored).not.toContain('plaintext-must-not-appear');
      await expect(provider.get(ref)).resolves.toEqual({ accessToken: 'plaintext-must-not-appear' });
      await provider.revoke(ref);
      expect(await readdir(directory)).toHaveLength(0);
    } finally {
      const resolved = path.resolve(directory);
      if (!resolved.startsWith(path.resolve(os.tmpdir()))) throw new Error('Unsafe temporary directory');
      await rm(resolved, { recursive: true, force: true });
    }
  });
});
