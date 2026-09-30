export function normalizeLoginIdentifier(value: string, appEnv: 'development' | 'staging' | 'production'): string {
  const normalized = value.trim().toLowerCase();
  if (appEnv === 'development' && normalized === 'admin') return 'admin@lazyarmor.local';
  return normalized;
}
