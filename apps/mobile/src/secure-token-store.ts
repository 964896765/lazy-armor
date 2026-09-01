import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { resolveTokenStoragePolicy } from './token-storage-policy';

const ACCESS_KEY = 'lazy_armor.access_token';
const REFRESH_KEY = 'lazy_armor.refresh_token';

export interface SessionTokens {
  accessToken: string;
  refreshToken?: string;
}

let memoryAccessToken: string | undefined;

// 移动端安全令牌存储：原生使用 SecureStore（Keychain/Keystore），Web 拒绝持久化 Refresh Token。
export async function persistTokens(tokens: SessionTokens): Promise<void> {
  const policy = resolveTokenStoragePolicy(Platform.OS === 'web' ? 'web' : 'native');
  if (Platform.OS === 'web') {
    memoryAccessToken = policy.canPersistAccessToken ? tokens.accessToken : undefined;
    // Web 绝不写 localStorage / 普通 AsyncStorage 保存 refresh token。
    return;
  }
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken);
  if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
}

export async function loadAccessToken(): Promise<string | undefined> {
  if (Platform.OS === 'web') return memoryAccessToken;
  return SecureStore.getItemAsync(ACCESS_KEY).then((value) => value ?? undefined).catch(() => undefined);
}

export async function loadRefreshToken(): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  return SecureStore.getItemAsync(REFRESH_KEY).then((value) => value ?? undefined).catch(() => undefined);
}

export async function clearTokens(): Promise<void> {
  if (Platform.OS === 'web') {
    memoryAccessToken = undefined;
    return;
  }
  await SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
}
