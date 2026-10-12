import { z } from 'zod';
export const reportDecisionInputSchema = z.object({
  requestId: z.string().min(1).max(120), conversationId: z.uuid(), messageId: z.uuid(),
  reportRevision: z.number().int().nonnegative(), reportHash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.string().trim().min(1).max(500), rationale: z.string().trim().max(300),
  expectedOutcome: z.string().trim().max(100), confirmed: z.literal(true),
}).strict();
export type ReportDecisionInput = z.infer<typeof reportDecisionInputSchema>;
export interface ReportDecisionSource { title: string; reportRevision: number; reportHash: string; goalId: string | null; goalVersion: number | null }
export function reportDecisionContent(input: Pick<ReportDecisionInput, 'decision' | 'rationale' | 'expectedOutcome'>) {
  return `本人决定：${input.decision}${input.rationale ? `\n本人理由：${input.rationale}` : ''}${input.expectedOutcome ? `\n预期（尚未验证）：${input.expectedOutcome}` : ''}\n这是本人的选择与预期；报告交付不代表市场事实或经营结果已核实。`;
}
