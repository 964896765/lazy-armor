import { reportBudgetSchema, type ReportBudget } from '@lazy-armor/plan-schema';

export interface ReportModelControl {
  reserve(): Promise<{ maxTokens: number; timeoutMs: number }>;
  recordUsage(usage: unknown): Promise<void>;
}

/** Reservations survive crashes, invalid JSON and network errors; never refund uncertain calls. */
export function initialReportBudget(now = Date.now()): ReportBudget {
  return reportBudgetSchema.parse({ deadlineAt: new Date(now + 20 * 60_000).toISOString(),
    maxModelCalls: 16, maxReservedOutputTokens: 131072, modelCalls: 0, reservedOutputTokens: 0,
    observedTotalTokens: 0, usageResponses: 0, costStatus: 'NOT_PRICED' });
}
export function assertReportDeadline(budget: ReportBudget, now = Date.now()) {
  if (now >= Date.parse(budget.deadlineAt)) throw new Error('REPORT_BUDGET_DEADLINE');
}
export function reserveReportCall(budget: ReportBudget, now = Date.now()) {
  assertReportDeadline(budget, now);
  if (budget.modelCalls >= budget.maxModelCalls || budget.reservedOutputTokens + 8192 > budget.maxReservedOutputTokens)
    throw new Error('REPORT_BUDGET_MODEL_LIMIT');
  return { budget: { ...budget, modelCalls: budget.modelCalls + 1, reservedOutputTokens: budget.reservedOutputTokens + 8192 },
    maxTokens: 8192, timeoutMs: Math.min(90_000, Date.parse(budget.deadlineAt) - now) };
}
export function recordReportUsage(budget: ReportBudget, usage: unknown): ReportBudget {
  const tokens = (usage as { total_tokens?: unknown } | null)?.total_tokens;
  if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0) return budget;
  return { ...budget, observedTotalTokens: budget.observedTotalTokens + tokens, usageResponses: budget.usageResponses + 1 };
}
