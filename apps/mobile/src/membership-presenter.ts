import { ApiError } from './api';

export interface MembershipSummary {
  membership: {
    planKey: string;
    effectivePlanKey: string;
    name: string;
    status: string;
    currentPeriodEnd: string | null;
  };
  capabilities: {
    advanced_ai: boolean;
    premium_connector: boolean;
    advanced_summary: boolean;
    premium_template: boolean;
  };
  limits: {
    max_active_plans: number;
    max_total_plans: number;
    history_retention_days: number;
  };
  usage: {
    activePlans: number;
    totalPlans: number;
  };
  upgrade: {
    available: boolean;
    mode: 'coming_soon' | 'sandbox';
  };
}

export interface UsageSummary {
  periodStart: string;
  periodEnd: string;
  plan: { active: number; limit: number };
  execution: { completed: number };
  advancedAi: { inputUnits: number; outputUnits: number; unit: 'characters' };
  connector: { operations: number };
  notification: { generated: number; delivered: number };
  storage: { fileBytes: number };
}

export const MEMBERSHIP_CAPABILITY_LABELS = [
  ['advanced_ai', '高级 AI'],
  ['premium_connector', '高级连接'],
  ['advanced_summary', '高级摘要'],
  ['premium_template', '高级模板'],
] as const;

export function activePlanUsageLabel(summary: MembershipSummary): string {
  return '已启用 ' + summary.usage.activePlans + ' / ' + summary.limits.max_active_plans + ' 个计划';
}

export function historyRetentionLabel(days: number): string {
  return '保留最近 ' + days + ' 天的历史记录';
}

export function usagePeriodLabel(periodStart: string): string {
  const date = new Date(periodStart);
  if (Number.isNaN(date.getTime())) return '本月用量';
  return date.getUTCFullYear() + ' 年 ' + (date.getUTCMonth() + 1) + ' 月用量';
}

export function formatFileBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function planMutationErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'PLAN_LIMIT_REACHED') return error.message;
  return '操作失败，请稍后重试。';
}
