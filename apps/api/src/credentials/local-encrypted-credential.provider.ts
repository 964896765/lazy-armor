import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { newId } from '@lazy-armor/shared';
import { CredentialProviderError, type Credential, type CredentialProvider } from './credential-provider';

interface EncryptedEnvelope { iv: string; tag: string; ciphertext: string }
interface StoredVersion { version: number; status: 'active' | 'superseded' | 'revoked'; envelope: EncryptedEnvelope }
interface VersionedStore { formatVersion: 1; currentVersion: number; versions: StoredVersion[] }

@Injectable()
export class LocalEncryptedCredentialProvider implements CredentialProvider {
  private readonly key: Buffer;
  private readonly directory: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('CREDENTIAL_MASTER_KEY'), 'base64');
    if (this.key.length !== 32) throw new Error('CREDENTIAL_MASTER_KEY must decode to exactly 32 bytes');
    this.directory = path.resolve(config.getOrThrow<string>('CREDENTIAL_STORE_PATH'));
  }

  async set(credential: Credential): Promise<string> {
    const ref = `local://${newId()}`;
    const store: VersionedStore = { formatVersion: 1, currentVersion: 1, versions: [{ version: 1, status: 'active', envelope: this.encrypt(credential) }] };
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.fileFor(ref), JSON.stringify(store), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return ref;
  }

  async get(ref: string, version?: number): Promise<Credential> {
    const store = await this.readStore(ref);
    const target = store.versions.find((item) => item.version === (version ?? store.currentVersion));
    if (!target) throw new CredentialProviderError('VERSION_NOT_FOUND', 'Credential version does not exist');
    if (target.status === 'revoked') throw new CredentialProviderError('REVOKED', 'Credential version has been revoked');
    return this.decrypt(target.envelope);
  }

  async rotate(ref: string, credential: Credential, expectedCurrentVersion?: number) {
    return this.withLock(ref, async () => {
      const store = await this.readStore(ref);
      if (expectedCurrentVersion !== undefined && store.currentVersion !== expectedCurrentVersion) {
        throw new CredentialProviderError('VERSION_CONFLICT', 'Credential was rotated concurrently');
      }
      const version = Math.max(...store.versions.map((item) => item.version)) + 1;
      for (const item of store.versions) if (item.status === 'active') item.status = 'superseded';
      store.versions.push({ version, status: 'active', envelope: this.encrypt(credential) });
      store.currentVersion = version;
      await this.writeStore(ref, store);
      return { ref, version };
    });
  }

  async currentVersion(ref: string) {
    return (await this.readStore(ref)).currentVersion;
  }

  async revokeVersion(ref: string, version: number): Promise<void> {
    await this.withLock(ref, async () => {
      const store = await this.readStore(ref);
      const target = store.versions.find((item) => item.version === version);
      if (!target) throw new CredentialProviderError('VERSION_NOT_FOUND', 'Credential version does not exist');
      target.status = 'revoked';
      if (store.currentVersion === version) {
        const fallback = [...store.versions].filter((item) => item.status !== 'revoked').sort((a, b) => b.version - a.version)[0];
        if (!fallback) throw new CredentialProviderError('REVOKED', 'Cannot revoke the final version without revoking the credential reference');
        fallback.status = 'active';
        store.currentVersion = fallback.version;
      }
      await this.writeStore(ref, store);
    });
  }

  async revoke(ref: string): Promise<void> {
    await this.withLock(ref, () => rm(this.fileFor(ref), { force: true }));
  }

  async health() {
    return { status: 'ok' as const, provider: 'local-encrypted' };
  }

  private fileFor(ref: string): string {
    const id = ref.match(/^local:\/\/([0-9a-f-]+)$/)?.[1];
    if (!id) throw new Error('Invalid local credential reference');
    return path.join(this.directory, `${id}.enc`);
  }

  private encrypt(credential: Credential): EncryptedEnvelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credential), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  }

  private decrypt(envelope: EncryptedEnvelope): Credential {
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8')) as Credential;
    } catch {
      throw new CredentialProviderError('INVALID_DATA', 'Credential ciphertext cannot be decrypted');
    }
  }

  private async readStore(ref: string): Promise<VersionedStore> {
    try {
      const parsed = JSON.parse(await readFile(this.fileFor(ref), 'utf8')) as VersionedStore | EncryptedEnvelope;
      if ('ciphertext' in parsed) return { formatVersion: 1, currentVersion: 1, versions: [{ version: 1, status: 'active', envelope: parsed }] };
      if (parsed.formatVersion !== 1 || !Number.isInteger(parsed.currentVersion) || !Array.isArray(parsed.versions)) throw new Error('invalid store');
      return parsed;
    } catch (error) {
      if (error instanceof CredentialProviderError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new CredentialProviderError('NOT_FOUND', 'Credential reference does not exist');
      if (code && ['EACCES', 'EPERM', 'EBUSY', 'EMFILE', 'ENFILE'].includes(code)) throw new CredentialProviderError('UNAVAILABLE', 'Credential store is unavailable', true);
      throw new CredentialProviderError('INVALID_DATA', 'Credential store is invalid');
    }
  }

  private async writeStore(ref: string, store: VersionedStore) {
    const target = this.fileFor(ref);
    const temporary = `${target}.${newId()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(store), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, target);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new CredentialProviderError('UNAVAILABLE', 'Credential store is unavailable', true);
    }
  }

  private async withLock<T>(ref: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(ref) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.locks.set(ref, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(ref) === tail) this.locks.delete(ref);
    }
  }
}
