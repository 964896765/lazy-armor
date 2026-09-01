// §8/§9 令牌存储策略（纯函数，便于单测）。
export interface TokenStoragePolicy {
  canPersistAccessToken: boolean;
  canPersistRefreshToken: boolean;
  note: string;
}

export function resolveTokenStoragePolicy(platform: 'web' | 'native'): TokenStoragePolicy {
  if (platform === 'native') {
    return { canPersistAccessToken: true, canPersistRefreshToken: true, note: 'iOS Keychain / Android Keystore via SecureStore' };
  }
  // Web：Refresh Token 绝不落 localStorage（§9）；仅内存保留 Access Token。
  return { canPersistAccessToken: false, canPersistRefreshToken: false, note: 'Web must use HttpOnly/Secure/SameSite cookie session; refresh token never persisted' };
}
