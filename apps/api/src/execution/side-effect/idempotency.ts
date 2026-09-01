import { createHash } from 'node:crypto';
import { canonicalStringify } from '@lazy-armor/plan-schema';

// Action Idempotency Key：平台控制、固定、不可由客户端覆盖。
// 绑定 user / execution / step / planVersion / action identity / connection / capability。
// input fingerprint 不参与 key 生成：同一步骤若携带不同 payload 复用同一 key，
// 必须由 Ledger 按 fingerprint 比对抛出 IDEMPOTENCY_KEY_CONFLICT（§8），而不是生成不同 key 悄悄放过。
export function deriveIdempotencyKey(input: {
  userId: string;
  executionId: string;
  executionStepId: string;
  planVersionId: string;
  planActionId: string;
  actionType: string;
  connectionId: string | null;
  capabilityKey: string | null;
}): string {
  return createHash('sha256').update(canonicalStringify(input)).digest('hex');
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalStringify(payload)).digest('hex');
}
