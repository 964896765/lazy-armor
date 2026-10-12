import { describe, expect, it } from 'vitest';
import type { ReportFinancial } from '@lazy-armor/plan-schema';
import { auditedReportFinancial, appendAuditedReportFinancial, reportFinancialAudit } from '../src/agent/reports/report-financial-audit';

const model: ReportFinancial = { operatingDays: 30, startupCosts: [{ name: '假设投入', yuan: 60000 }],
  fixedMonthlyCosts: [{ name: '固定月成本', yuan: 9000 }], monthlyDepreciationYuan: 1000,
  scenarios: [10, 20, 30].map(carsPerDay => ({ name: `${carsPerDay}台`, carsPerDay, washPriceYuan: 30,
    washVariableYuan: 6, beautyConversion: 0.1, beautyPriceYuan: 100, beautyVariableRate: 0.4 })) };

describe('program financial context for autonomous writing and review', () => {
  it('separates the per-car input from the monthly variable total and profit', () => {
    // Base: 600 washes, 18000 wash + 6000 beauty, variable 3600 + 2400, fixed 9000.
    expect(reportFinancialAudit(model)!.scenarios[1]).toMatchObject({ monthlyWashes: 600, washVariableYuanPerCar: 6,
      monthlyRevenueYuan: 24000, monthlyVariableYuan: 6000, cashProfitYuan: 9000 });
  });
  it('compares equal percentage revenue changes without inferring profit sensitivity', () => {
    const base = reportFinancialAudit(model)!.scenarios[1]!;
    expect(base.revenueElasticities).toEqual({ washPrice: 0.75, beautyConversion: 0.25 });
    const priceChange = reportFinancialAudit({ ...model, scenarios: model.scenarios.map(s => ({ ...s, washPriceYuan: s.washPriceYuan * 1.1 })) })!.scenarios[1]!;
    const conversionChange = reportFinancialAudit({ ...model, scenarios: model.scenarios.map(s => ({ ...s, beautyConversion: s.beautyConversion * 1.1 })) })!.scenarios[1]!;
    expect((priceChange.monthlyRevenueYuan / base.monthlyRevenueYuan - 1) / 0.1).toBeCloseTo(base.revenueElasticities.washPrice!);
    expect((conversionChange.monthlyRevenueYuan / base.monthlyRevenueYuan - 1) / 0.1).toBeCloseTo(base.revenueElasticities.beautyConversion!);
  });
  it('does not invent sensitivity when revenue is zero or the report has no financial model', () => {
    const zero = reportFinancialAudit({ ...model, scenarios: model.scenarios.map(s => ({ ...s, carsPerDay: 0 })) })!;
    expect(zero.scenarios.every(s => s.revenueElasticities.washPrice === null && s.revenueElasticities.beautyConversion === null)).toBe(true);
    expect(reportFinancialAudit(null)).toBeUndefined();
  });
  it('makes the computed review evidence visible and replaces old appendix values on regeneration', () => {
    const source = auditedReportFinancial(model);
    expect(source.financialAudit.scenarios[1]!.revenueElasticities).toEqual({ washPrice: 0.75, beautyConversion: 0.25 });
    const first = appendAuditedReportFinancial('报告正文', model);
    expect(first).toContain('| 20台 | 0.7500 | 0.2500 |');
    const changed = { ...model, scenarios: model.scenarios.map(s => ({ ...s, beautyPriceYuan: 300 })) };
    const updated = appendAuditedReportFinancial(first, changed);
    expect(updated).toContain('| 20台 | 0.5000 | 0.5000 |');
    expect(updated).not.toContain('0.7500');
    expect(appendAuditedReportFinancial(updated, changed)).toBe(updated);
  });
});
