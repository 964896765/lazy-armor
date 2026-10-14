import type { passkeyCredentials } from '@lazy-armor/database';
export type PasskeyCredential = typeof passkeyCredentials.$inferSelect;
export interface PasskeyLoginProof {
  observed: PasskeyCredential;
  expiresAt: number;
  newCounter: number;
  backedUp: boolean;
}
export const passkeyUserHandle = (userId: string) => Buffer.from(userId.replace(/-/g, ''), 'hex');
