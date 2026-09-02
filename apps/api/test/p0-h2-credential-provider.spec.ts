import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import { CredentialProviderError } from '../src/credentials/credential-provider';
import { LocalEncryptedCredentialProvider } from '../src/credentials/local-encrypted-credential.provider';

describe('P0-H2 versioned credential provider', () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  async function provider() {
    const directory = await mkdtemp(path.join(tmpdir(), 'lazy-armor-credential-'));
    directories.push(directory);
    const values = { CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'), CREDENTIAL_STORE_PATH: directory };
    return { instance: new LocalEncryptedCredentialProvider(new ConfigService(values)), values };
  }

  it('serializes concurrent rotation, survives restart, and supports version/reference revoke', async () => {
    const created = await provider();
    const ref = await created.instance.set({ token: 'version-one' });
    const rotations = await Promise.allSettled([
      created.instance.rotate(ref, { token: 'version-two-a' }, 1),
      created.instance.rotate(ref, { token: 'version-two-b' }, 1),
    ]);
    expect(rotations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = rotations.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(CredentialProviderError);
    expect((rejected?.reason as CredentialProviderError).code).toBe('VERSION_CONFLICT');
    expect(await created.instance.currentVersion(ref)).toBe(2);

    const restarted = new LocalEncryptedCredentialProvider(new ConfigService(created.values));
    const current = await restarted.get(ref, 2);
    expect(['version-two-a', 'version-two-b']).toContain(current.token);
    await restarted.revokeVersion(ref, 2);
    expect(await restarted.currentVersion(ref)).toBe(1);
    expect(await restarted.get(ref)).toEqual({ token: 'version-one' });
    await restarted.revoke(ref);
    await expect(restarted.get(ref)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
