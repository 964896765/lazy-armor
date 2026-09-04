import * as SecureStore from 'expo-secure-store';

const DEVICE_INSTALLATION_ID_KEY = 'lazy-armor-device-installation-id';
let memoryFallback: string | null = null;

export async function deviceInstallationId(): Promise<string> {
  const available = await SecureStore.isAvailableAsync().catch(() => false);
  if (!available) return memoryId();
  const existing = await SecureStore.getItemAsync(DEVICE_INSTALLATION_ID_KEY).catch(() => null);
  if (existing) return existing;
  const created = randomId();
  await SecureStore.setItemAsync(DEVICE_INSTALLATION_ID_KEY, created).catch(() => undefined);
  return created;
}

function memoryId() {
  if (!memoryFallback) memoryFallback = randomId();
  return memoryFallback;
}

function randomId() {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}
