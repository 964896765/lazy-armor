import { z } from 'zod';
const money = z.number().finite().min(0).max(1000000);
export const reportFinancialSchema = z.object({
  operatingDays: z.number().int().min(1).max(31),
  startupCosts: z.array(z.object({ name: z.string().min(1).max(80), yuan: money }).strict()).min(1).max(12),
  fixedMonthlyCosts: z.array(z.object({ name: z.string().min(1).max(80), yuan: money }).strict()).min(1).max(12),
  monthlyDepreciationYuan: money,
  scenarios: z.array(z.object({ name: z.string().min(1).max(40), carsPerDay: z.number().finite().min(0).max(1000),
    washPriceYuan: money, washVariableYuan: money, beautyConversion: z.number().finite().min(0).max(1),
    beautyPriceYuan: money, beautyVariableRate: z.number().finite().min(0).max(1),
  }).strict()).length(3),
}).strict();
export type ReportFinancial = z.infer<typeof reportFinancialSchema>;
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function calculateReportFinancial(input: ReportFinancial) {
  const model = reportFinancialSchema.parse(input);
  const startupYuan = round(model.startupCosts.reduce((sum, row) => sum + row.yuan, 0));
  const fixedMonthlyYuan = round(model.fixedMonthlyCosts.reduce((sum, row) => sum + row.yuan, 0));
  return { assumptions: model, startupYuan, fixedMonthlyYuan, scenarios: model.scenarios.map(s => {
    const washes = s.carsPerDay * model.operatingDays;
    const washRevenueYuan = round(washes * s.washPriceYuan), beautyRevenueYuan = round(washes * s.beautyConversion * s.beautyPriceYuan);
    const variableYuan = round(washes * s.washVariableYuan + beautyRevenueYuan * s.beautyVariableRate);
    const revenueYuan = round(washRevenueYuan + beautyRevenueYuan), contributionYuan = round(revenueYuan - variableYuan);
    const cashProfitYuan = round(contributionYuan - fixedMonthlyYuan), profitAfterDepreciationYuan = round(cashProfitYuan - model.monthlyDepreciationYuan);
    const contributionPerWash = s.washPriceYuan - s.washVariableYuan + s.beautyConversion * s.beautyPriceYuan * (1 - s.beautyVariableRate);
    return { name: s.name, monthlyWashes: round(washes), expectedMonthlyBeautyOrders: round(washes * s.beautyConversion),
      washRevenueYuan, beautyRevenueYuan, revenueYuan, variableYuan, contributionYuan, cashProfitYuan, profitAfterDepreciationYuan,
      contributionPerWashYuan: round(contributionPerWash),
      breakEvenCarsPerDay: contributionPerWash > 0 ? round(fixedMonthlyYuan / contributionPerWash / model.operatingDays) : null,
      breakEvenAfterDepreciationCarsPerDay: contributionPerWash > 0 ? round((fixedMonthlyYuan + model.monthlyDepreciationYuan) / contributionPerWash / model.operatingDays) : null,
      cashSafetyMarginPercent: contributionPerWash > 0 && s.carsPerDay > 0 ? round((1 - fixedMonthlyYuan / contributionPerWash / model.operatingDays / s.carsPerDay) * 100) : null,
      paybackMonths: cashProfitYuan > 0 ? round(startupYuan / cashProfitYuan) : null };
  }) };
}
export const FINANCIAL_APPENDIX = '## 程序计算附录（模型假设）';
export function appendReportFinancial(markdown: string, model: ReportFinancial) {
  const r = calculateReportFinancial(model);
  const costs = (rows: Array<{ name: string; yuan: number }>) => rows.map(row => `| ${row.name.replace(/[|\n]/g, ' ')} | ${row.yuan.toFixed(2)} |`).join('\n');
  const body = markdown.split(FINANCIAL_APPENDIX)[0]!.trim();
  return body + '\n\n' + FINANCIAL_APPENDIX + '\n\n[M1] 以下参数由模型提出，均为测算假设，未经当地市场核实；金额单位为人民币元，结果保留两位小数。\n\n'
    + `每月营业 ${model.operatingDays} 天，是用于测算的有效营业天数假设；未确定实际员工轮休、每日营业工时、洗车与美容服务时长。美容订单来自洗车客户的追加购买，不新增洗车台次，但额外占用人员和工位。三种情景是需求假设，不是已验证产能；签约前须用工位数、各项目耗时、排班与天气停业核验，不能据此认定乐观台次可实现。\n\n### 初始投资假设\n\n| 项目 | 元 |\n|---|---:|\n${costs(model.startupCosts)}\n| 合计 | ${r.startupYuan.toFixed(2)} |\n\n`
    + `### 月固定现金成本假设\n\n| 项目 | 元/月 |\n|---|---:|\n${costs(model.fixedMonthlyCosts)}\n| 合计 | ${r.fixedMonthlyYuan.toFixed(2)} |\n\n月折旧另计 ${model.monthlyDepreciationYuan.toFixed(2)} 元，是独立的简化月度假设，不由初始投资总额推导；尚未逐项确定折旧资产基数、残值和年限，不代表法定会计折旧。老板报酬、税费、社保等是否计入以此明细为准，缺项需另加。现金经营利润和含折旧利润只扣除表内列明的税费，不称为税前利润、税后净利润或可分配现金；实际适用税种、计税规则、老板与员工岗位分工待核实。\n\n`
    + '### 三情景输入参数（模型假设）\n\n| 情景 | 日洗车台次 | 洗车价 | 单台洗车变动成本 | 美容转化率 | 美容客单价 | 美容变动成本率 |\n|---|---:|---:|---:|---:|---:|---:|\n'
    + model.scenarios.map(s => `| ${s.name} | ${s.carsPerDay} | ${s.washPriceYuan} | ${s.washVariableYuan} | ${round(s.beautyConversion * 100)}% | ${s.beautyPriceYuan} | ${round(s.beautyVariableRate * 100)}% |`).join('\n')
    + '\n\n### 三情景结果（程序计算）\n\n| 情景 | 月收入 | 月变动成本 | 贡献毛利 | 月现金经营利润 | 含折旧利润 | 现金保本台/日 | 静态现金回收月数 |\n|---|---:|---:|---:|---:|---:|---:|---:|\n'
    + r.scenarios.map(s => `| ${s.name} | ${s.revenueYuan.toFixed(2)} | ${s.variableYuan.toFixed(2)} | ${s.contributionYuan.toFixed(2)} | ${s.cashProfitYuan.toFixed(2)} | ${s.profitAfterDepreciationYuan.toFixed(2)} | ${s.breakEvenCarsPerDay ?? '无法保本'} | ${s.paybackMonths ?? '亏损，无回收期'} |`).join('\n')
    + '\n\n| 情景 | 综合单台贡献毛利（元） | 含折旧保本台/日 | 现金安全边际率 |\n|---|---:|---:|---:|\n'
    + r.scenarios.map(s => `| ${s.name} | ${s.contributionPerWashYuan.toFixed(2)} | ${s.breakEvenAfterDepreciationCarsPerDay ?? '无法保本'} | ${s.cashSafetyMarginPercent === null ? '无法计算' : `${s.cashSafetyMarginPercent}%`} |`).join('\n')
    + '\n\n月洗车台次 = 日洗车台次 × 营业天数。美容期望订单 = 月洗车台次 × 美容转化率。月收入 = 月洗车台次 ×（洗车价 + 美容转化率 × 美容客单价）。月变动成本 = 月洗车台次 × 单台洗车变动成本 + 美容收入 × 美容变动成本率。月贡献毛利 = 月收入 − 月变动成本，未扣固定成本和折旧。综合单台贡献毛利 = 洗车价 − 单台洗车变动成本 + 美容转化率 × 美容客单价 ×（1 − 美容变动成本率）。现金经营利润 = 月贡献毛利 − 固定现金成本。含折旧利润 = 现金经营利润 − 月折旧。现金保本日台次 = 固定现金成本 ÷ 综合单台贡献毛利 ÷ 营业天数；含折旧保本日台次的分子为固定现金成本 + 月折旧。现金安全边际率 =（实际假设日台次 − 未四舍五入现金保本日台次）÷ 实际假设日台次；负值表示未保本，零台次或非正贡献时不计算。静态现金回收期 = 全部初始资金合计（包含表内预留营运资金，不剔除任何科目）÷ 正的月现金经营利润，不重复扣除折旧；非正利润无回收期。计算中间值按公式计算，显示金额保留两位，保本台次和比率保留两位，不将美容期望订单取整成实际订单。未计启动爬坡、融资成本、资金时间价值、残值、营运资金回收及表外税费，结果不表示实际收益承诺。\n\n'
    + '### 口径限制与签约前核验\n\n税费如列在固定成本表，取值是固定月额的测算假设，不是按收入或利润计算的真实税额；实际税制需重算。若初始资金含押金和首期租金，回收分子按全部资金占用保守测算，未扣未来押金退还或营运资金释放；不声称这是沉没成本回收期。首期租金与月租金可能存在预付款时间差，本模型只估算稳定经营月，不是逐月现金流表。\n\n美容转化率表示每次洗车最多一次追加美容的期望比例，无独立美容客流；收入、保本与回收计算成立的前提是两类服务都能交付。签约前需实测：日洗车台次 ×（单次洗车工位占用时长 + 美容转化率 × 单次美容工位占用时长）不得超过各工位每日有效可用时间之和，并分别检查两类服务需要的人员工时、专用工位和高峰排队。产能不足时必须降低情景台次或转化率后重算，不能继续沿用此盈利判断。现无服务时长和营业工时数据，无法确定产能上限，故各情景均未通过产能可行性核验。\n\n其它参数固定时，有效营业天数下降使收入和贡献毛利同比下降、固定成本不变，现金保本日台次上升，安全边际下降；天气停业和员工排班均应纳入有效营业天数实测。租金上升会增加固定成本；排水条件与服务效率影响初始改造、单台变动成本及可实现台次，选址后应替换这些假设。\n';
}
