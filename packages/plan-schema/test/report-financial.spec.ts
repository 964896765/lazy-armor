import { describe, expect, it } from 'vitest';
import { calculateReportFinancial, appendReportFinancial, type ReportFinancial } from '../src/report-financial';
const input: ReportFinancial = { operatingDays: 30, startupCosts: [{ name: '投资', yuan: 60000 }], fixedMonthlyCosts: [{ name: '成本', yuan: 9000 }], monthlyDepreciationYuan: 1000,
  scenarios: [10, 20, 30].map(carsPerDay => ({ name: `${carsPerDay}台`, carsPerDay, washPriceYuan: 30, washVariableYuan: 6, beautyConversion: 0.1, beautyPriceYuan: 100, beautyVariableRate: 0.4 })) };
describe('generated assumptions, program calculated finances', () => {
  it('computes consistent revenue, profit, break-even and payback with loss kept', () => {
    const r = calculateReportFinancial(input); const [loss, base, high] = r.scenarios;
    expect(r.startupYuan).toBe(60000); expect(r.fixedMonthlyYuan).toBe(9000);
    expect(base).toMatchObject({ monthlyWashes: 600, expectedMonthlyBeautyOrders: 60, revenueYuan: 24000, variableYuan: 6000, contributionYuan: 18000, cashProfitYuan: 9000, profitAfterDepreciationYuan: 8000, contributionPerWashYuan: 30, breakEvenCarsPerDay: 10, breakEvenAfterDepreciationCarsPerDay: 11.11, cashSafetyMarginPercent: 50, paybackMonths: 6.67 });
    expect(loss?.cashProfitYuan).toBe(0); expect(loss?.paybackMonths).toBeNull();
    expect(high?.cashProfitYuan).toBe(18000);
  });
  it('does not claim a break-even or payback when unit contribution is negative', () => {
    const r = calculateReportFinancial({ ...input, scenarios: input.scenarios.map(s => ({ ...s, washVariableYuan: 50 })) });
    expect(r.scenarios.every(s => s.breakEvenCarsPerDay === null && s.breakEvenAfterDepreciationCarsPerDay === null && s.cashSafetyMarginPercent === null && s.paybackMonths === null)).toBe(true);
  });
  it('keeps the full startup funding and reports negative or undefined safety margins', () => {
    const r = calculateReportFinancial({ ...input, startupCosts: [...input.startupCosts, { name: '预留营运资金', yuan: 30000 }], scenarios: input.scenarios.map((s, i) => ({ ...s, carsPerDay: i * 5 })) });
    expect(r.startupYuan).toBe(90000);
    expect(r.scenarios[0]?.cashSafetyMarginPercent).toBeNull();
    expect(r.scenarios[1]?.cashSafetyMarginPercent).toBe(-100);
    expect(r.scenarios[2]?.cashSafetyMarginPercent).toBe(0);
  });
  it('replaces the old calculated appendix and labels the parameters as unverified assumptions', () => {
    const first = appendReportFinancial('报告正文', input); const second = appendReportFinancial(first, input);
    expect(second).toBe(first); expect(second).toContain('未经当地市场核实'); expect(second).toContain('24000.00');
  });
});
