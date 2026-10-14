import { isIP } from 'node:net';
export interface PasskeyConfig { rpID: string; origins: string[] }

// RP/Origin are deployment settings, never derived from Host/forwarded headers.
export function parsePasskeyConfig(input: {AUTH_PASSKEY_ENABLED?: string;AUTH_PASSKEY_RP_ID?: string;AUTH_PASSKEY_ORIGINS?: string;NODE_ENV?: string;APP_ENV?: string}): PasskeyConfig | undefined {
  if (input.AUTH_PASSKEY_ENABLED !== 'true') return;
  const rpID = input.AUTH_PASSKEY_RP_ID ?? '';
  const local = input.NODE_ENV !== 'production' && (input.APP_ENV ?? 'development') === 'development';
  if (rpID.length > 253 || isIP(rpID) || !rpID.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || (rpID !== 'localhost' && !rpID.includes('.')) || (rpID === 'localhost' && !local)) throw new Error('Passkey requires a fixed trusted RP ID');
  const origins = (input.AUTH_PASSKEY_ORIGINS ?? '').split(',');
  if (origins.length > 8 || new Set(origins).size !== origins.length) throw new Error('Passkey requires explicit trusted origins');
  for (const origin of origins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('Passkey requires explicit trusted origins'); }
    // Initial Web rollout deliberately requires exact RP hostname, no wildcard/subdomain trust.
    if (url.origin !== origin || url.hostname !== rpID || url.username || url.password || (url.protocol !== 'https:' && !(local && rpID === 'localhost' && url.protocol === 'http:'))) throw new Error('Passkey requires HTTPS trusted origins matching the RP ID');
  }
  return { rpID, origins };
}
