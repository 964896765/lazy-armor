import { z } from 'zod';

export const learningSourceSchema = z.object({
  executionId: z.uuid(), executionStepId: z.uuid(), operationId: z.uuid(), evidenceId: z.uuid(),
  planVersionId: z.uuid().nullable(), actionIntentId: z.uuid().nullable(),
  policyId: z.uuid(), policyHash: z.string().length(64), evidenceHash: z.string().length(64),
  requestHash: z.string().length(64), inputFingerprint: z.string().length(64),
  definitionHash: z.string().length(64),
  method: z.string().min(1).max(32), outcome: z.enum(['SUCCEEDED', 'FAILED', 'PARTIALLY_SUCCEEDED']),
  actionType: z.string().min(1).max(64), scope: z.string().min(1).max(120), verifiedAt: z.iso.datetime(),
  connection: z.object({ id: z.uuid(), credentialRefId: z.uuid().nullable(), permissionId: z.uuid(),
    grantedAt: z.string().nullable(), expiresAt: z.string().nullable(), providerGrantHash: z.string().length(64).nullable() }).strict().nullable(),
}).strict();
export type LearningSource = z.infer<typeof learningSourceSchema>;
export interface LearningCandidate {
  id: string; version: number; status: 'PENDING' | 'CONFIRMED' | 'DISMISSED' | 'UNAVAILABLE' | 'EXPIRED';
  title: string | null; content: string | null; source: LearningSource | null;
  sampleCount: 1; limitations: string; createdAt: string; expiresAt: string;
  memoryId: string | null; confirmedMemoryVersion: number | null;
}
export const LEARNING_LIMITATIONS = '仅证明这一次操作在记录时的核验结果；不能推断未来成功率、市场事实或永久偏好，也不构成执行授权。';
export function learningSummary(source: LearningSource): string {
  const result = { SUCCEEDED: '成功', FAILED: '失败', PARTIALLY_SUCCEEDED: '部分成功' }[source.outcome];
  return `「${source.scope}」的一次操作于 ${source.verifiedAt} 核验为${result}。样本数：1。${LEARNING_LIMITATIONS}`;
}
