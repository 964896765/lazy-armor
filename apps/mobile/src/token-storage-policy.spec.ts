import { describe, expect, it } from 'vitest';
import { resolveTokenStoragePolicy } from './token-storage-policy';

describe('token storage policy', () => {
  it('persists access and refresh tokens in secure native storage', () => {
    const native = resolveTokenStoragePolicy('native');
    expect(native.canPersistAccessToken).toBe(true);
    expect(native.canPersistRefreshToken).toBe(true);
    expect(native.note).toContain('Keychain');
  });

  it('never persists refresh tokens in web storage', () => {
    const web = resolveTokenStoragePolicy('web');
    expect(web.canPersistAccessToken).toBe(false);
    expect(web.canPersistRefreshToken).toBe(false);
    expect(web.note).toContain('HttpOnly');
  });
});
