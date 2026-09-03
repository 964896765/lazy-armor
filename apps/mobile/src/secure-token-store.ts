import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { resolveTokenStoragePolicy } from './token-storage-policy';

const ACCESS_KEY = 'lazy_armor.access_token';
const REFRESH_KEY = 'lazy_armor.refresh_token';
const ONBOARDING_KEY = 'lazy_armor.onboarding_required';

export interface SessionTokens {
  accessToken: string;
  refreshToken?: string;
}

let memoryAccessToken: string | undefined;
let memoryOnboardingRequired = false;
const nativeStorageOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// 移动端安全令牌存储：原生使用 SecureStore（Keychain/Keystore），Web 拒绝持久化 Refresh Token。
export async function persistTokens(tokens: SessionTokens): Promise<void> {
  const policy = resolveTokenStoragePolicy(Platform.OS === 'web' ? 'web' : 'native');
  if (Platform.OS === 'web') {
    memoryAccessToken = policy.canPersistAccessToken ? tokens.accessToken : undefined;
    // Web 绝不写 localStorage / 普通 AsyncStorage 保存 refresh token。
    return;
  }
  // Rotation writes the new refresh token first: a process death between writes
  // leaves a usable refresh token with an older access token, never the reverse.
  if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken, nativeStorageOptions);
  else await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken, nativeStorageOptions);
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

export async function persistOnboardingRequired(required: boolean): Promise<void> {
  if (Platform.OS === 'web') {
    memoryOnboardingRequired = required;
    return;
  }
  await SecureStore.setItemAsync(ONBOARDING_KEY, required ? 'true' : 'false', nativeStorageOptions);
}

export async function loadOnboardingRequired(): Promise<boolean> {
  if (Platform.OS === 'web') return memoryOnboardingRequired;
  return SecureStore.getItemAsync(ONBOARDING_KEY).then((value) => value === 'true').catch(() => false);
}

export async function clearOnboardingState(): Promise<void> {
  if (Platform.OS === 'web') {
    memoryOnboardingRequired = false;
    return;
  }
  await SecureStore.deleteItemAsync(ONBOARDING_KEY).catch(() => undefined);
}
