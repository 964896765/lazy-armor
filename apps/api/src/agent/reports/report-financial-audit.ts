import { appendReportFinancial, calculateReportFinancial, type ReportFinancial } from '@lazy-armor/plan-schema';

/** Computed review context, not market evidence. Keeps per-car costs separate from monthly totals. */
export function reportFinancialAudit(model?: ReportFinancial | null) {
  if (!model) return undefined;
  const calculated = calculateReportFinancial(model);
  return {
    provenance: 'MODEL_ASSUMPTIONS_CALCULATED' as const,
    period: 'MONTH' as const,
    cashProfitFormula: 'monthlyRevenueYuan - monthlyVariableYuan - fixedMonthlyYuan',
    variableCostFormula: 'monthlyWashes * washVariableYuanPerCar + monthlyBeautyRevenueYuan * beautyVariableRate',
    operatingDaysEffect: '其它参数不变时，有效营业天数变化使月收入、月变动成本和贡献毛利按相同比例变化，固定月成本不变；金额降幅不同不表示比例降幅不同。',
    fixedMonthlyYuan: calculated.fixedMonthlyYuan,
    scenarios: calculated.scenarios.map((scenario, index) => ({
      name: scenario.name,
      monthlyWashes: scenario.monthlyWashes,
      washVariableYuanPerCar: model.scenarios[index]!.washVariableYuan,
      monthlyRevenueYuan: scenario.revenueYuan,
      monthlyWashRevenueYuan: scenario.washRevenueYuan,
      monthlyBeautyRevenueYuan: scenario.beautyRevenueYuan,
      monthlyVariableYuan: scenario.variableYuan,
      cashProfitYuan: scenario.cashProfitYuan,
      // Equal percentage changes with all other assumptions fixed; revenue only.
      revenueElasticities: {
        washPrice: scenario.revenueYuan > 0 ? scenario.washRevenueYuan / scenario.revenueYuan : null,
        beautyConversion: scenario.revenueYuan > 0 ? scenario.beautyRevenueYuan / scenario.revenueYuan : null,
      },
    })),
  };
}

/** Includes the same audit values supplied to writing/review in the user's financial evidence. */
export function auditedReportFinancial(model: ReportFinancial) {
  return { ...calculateReportFinancial(model), financialAudit: reportFinancialAudit(model)! };
}

export function appendAuditedReportFinancial(markdown: string, model: ReportFinancial) {
  const audit = reportFinancialAudit(model)!;
  const elasticity = (value: number | null) => value === null ? '无法计算' : value.toFixed(4);
  return appendReportFinancial(markdown, model)
    + '\n\n### 收入敏感性（程序计算，模型假设）\n\n'
    + '| 情景 | 洗车单价的收入弹性 | 美容转化率的收入弹性 |\n|---|---:|---:|\n'
    + audit.scenarios.map(scenario => `| ${scenario.name.replace(/[|\n]/g, ' ')} | ${elasticity(scenario.revenueElasticities.washPrice)} | ${elasticity(scenario.revenueElasticities.beautyConversion)} |`).join('\n')
    + '\n\n弹性为无量纲比率：洗车单价的收入弹性 = 洗车收入 ÷ 总收入；美容转化率的收入弹性 = 美容收入 ÷ 总收入。其它参数不变时，单价或转化率提高1%，总收入分别提高该弹性乘以1%。仅能在同一情景内比较同等百分比变化对收入的影响，不表示利润弹性、不同绝对幅度变化或真实客流反应；零收入时不计算。不同情景多参数同时改变，不能用于证明单变量影响更强。\n\n'
    + audit.operatingDaysEffect + '\n';
}
