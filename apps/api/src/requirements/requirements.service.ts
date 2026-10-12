import { BadRequestException, Injectable } from '@nestjs/common';
import {
  catalogHash, deliverySpecSchema, goalBriefSchema, GOAL_BRIEF_FIELDS,
  type DeliverySpec, type GoalBrief, type GoalBriefField, type GoalBriefRef,
  type GoalUnderstanding, type RequirementSourceRef,
} from '@lazy-armor/plan-schema';

type FieldKey = GoalBriefField['key'];
export interface RequirementSuggestion { key: FieldKey; value: string; quote?: string }
/** Only the server's reviewed Memory/Truth adapters supply these, never an authoring DTO. */
export interface ConfirmedRequirementSource {
  key: FieldKey; value: string; content: string; sourceRef: RequirementSourceRef;
}
export interface CompileGoalBriefInput {
  goalId: string;
  version?: number;
  intent: string;
  messageId: string;
  understanding?: GoalUnderstanding;
  previous?: GoalBrief;
  confirmedSources?: ConfirmedRequirementSource[];
  suggestions?: RequirementSuggestion[];
}

/** Evidence-aware adapter around the existing planner. No model call or authority writes. */
@Injectable()
export class RequirementsService {
  compile(input: CompileGoalBriefInput): GoalBrief {
    const intent = input.intent.trim();
    if (!intent || intent.length > 12000 || !input.messageId) throw new BadRequestException('GOAL_BRIEF_USER_SOURCE_REQUIRED');
    const version = input.version ?? 1;
    const previous = input.previous ? goalBriefSchema.parse(input.previous) : undefined;
    if (previous && (previous.goalId !== input.goalId || previous.version > version)) throw new BadRequestException('GOAL_BRIEF_SOURCE_CHANGED');
    const report = /报告|商业评估|可行性分析|商业分析/.test(intent);
    const carWashBusiness = /洗车/.test(intent) && /商业|经营|投资|盈亏|评估|报告/.test(intent)
      && !/(?:不做|不再做|不要做|取消)[^，,。；;]{0,8}洗车/.test(intent);
    const explicitSwitch = /^(?:改为|改成|换成|换为|改做|换做|换个目标|新的目标|另一个目标)/.test(intent)
      || /(?:不做|不再做)[^，,。；;]*[，,。；;].*(?:改为|改做|换成)/.test(intent);
    const conditionUpdate = /^(?:预算|投资额|启动资金|投入资金|成本|工位|门店面积|经营模式|地点|地区|时间|截止时间)/.test(intent)
      && !/(?:改为|改成|换成|换为).{0,15}(?:旅行|旅游|餐饮|咖啡|短视频|电商|行业|项目)/.test(intent);
    const repeatReport = /^(?:重新|继续|再次)(?:生成|写|撰写)?(?:一份|完整)?(?:原|该|这份)?(?:商业|经营|投资|盈亏)?(?:评估)?报告[。！!\s]*$/.test(intent)
      || /^按(?:上述条件|上述假设|原条件|原方案).{0,6}(?:生成|写|评估)?报告[。！!\s]*$/.test(intent);
    const inheritSubject = !explicitSwitch && (conditionUpdate || repeatReport) && previous?.reportSubject;
    const scopeChanged = explicitSwitch || Boolean(previous?.reportSubject && report && !inheritSubject
      && (carWashBusiness ? previous.reportSubject.kind !== 'CAR_WASH_BUSINESS' : previous.reportSubject.kind === 'CAR_WASH_BUSINESS'));
    const fields = new Map<FieldKey, GoalBriefField>(GOAL_BRIEF_FIELDS.map(key => [key, { key, value: null, status: 'UNKNOWN', sourceRefs: [] }]));
    for (const field of scopeChanged ? [] : previous?.fields ?? []) fields.set(field.key, structuredClone(field));
    const userField = (key: FieldKey, value: string, quote = value) => fields.set(key, {
      key, value, status: 'USER_STATED', sourceRefs: [{ kind: 'USER_MESSAGE', id: input.messageId, quote }],
    });
    // Keep the user's actual request, rather than promoting a model paraphrase to fact.
    userField('goal', intent);
    for (const source of input.confirmedSources ?? []) {
      if (source.key === 'goal') continue;
      const grounded = ['CONFIRMED_MEMORY', 'VERIFIED_TRUTH'].includes(source.sourceRef.kind)
        && source.content.includes(source.sourceRef.quote) && source.sourceRef.quote.includes(source.value);
      if (!grounded) throw new BadRequestException('GOAL_BRIEF_CONFIRMED_SOURCE_NOT_GROUNDED');
      // The more recent direct statement wins over historical memory.
      if (fields.get(source.key)?.status !== 'USER_STATED') fields.set(source.key, {
        key: source.key, value: source.value, status: 'CONFIRMED', sourceRefs: [source.sourceRef],
      });
    }
    for (const [key, expression] of USER_FIELD_PATTERNS) {
      const match = expression.exec(intent);
      if (match) {
        const preceding = intent.slice(Math.max(0, match.index - 16), match.index);
        const following = intent.slice(match.index + match[0].length, match.index + match[0].length + 24);
        if (/(?:不是|并非|不按|不再是)\s*$/.test(preceding)) fields.set(key, { key, value: null, status: 'UNKNOWN', sourceRefs: [] });
        else if (/(?:假设|假定|举例|例如|示例|如果|模拟|暂按|情景)[^，,。；;]{0,12}$/.test(preceding)
          || /^\s*(?:只作|仅作|仅为|仅作为|只作为|作为|是)?(?:本次|本轮)?(?:测算|情景|模拟)?假设/.test(following))
          fields.set(key, { key, value: match[0].trim(), status: 'ASSUMPTION', sourceRefs: [] });
        else userField(key, match[0].trim());
      }
    }
    if (/预算(?:改为|改成|调整为|调整到)?(?:不是|并非|不再是|不确定|待定|未知|还没确定|未确定)/.test(intent))
      fields.set('budget', { key: 'budget', value: null, status: 'UNKNOWN', sourceRefs: [] });
    for (const suggestion of input.suggestions ?? []) {
      if (suggestion.key === 'goal') continue;
      const value = suggestion.value.trim();
      if (!value) continue;
      if (suggestion.quote && intent.includes(suggestion.quote) && suggestion.quote.includes(value)) {
        const at = intent.indexOf(suggestion.quote);
        const preceding = intent.slice(Math.max(0, at - 16), at) + suggestion.quote.slice(0, suggestion.quote.indexOf(value));
        if (/(?:不是|并非|不按|不再是)[^，,。；;]{0,12}$/.test(preceding))
          fields.set(suggestion.key, { key: suggestion.key, value: null, status: 'UNKNOWN', sourceRefs: [] });
        else if (/(?:假设|假定|举例|例如|示例|如果|模拟|暂按|情景)[^，,。；;]{0,12}$/.test(preceding))
          fields.set(suggestion.key, { key: suggestion.key, value, status: 'ASSUMPTION', sourceRefs: [] });
        else userField(suggestion.key, value, suggestion.quote);
      } else if (!['USER_STATED', 'CONFIRMED'].includes(fields.get(suggestion.key)!.status)) {
        fields.set(suggestion.key, { key: suggestion.key, value, status: 'ASSUMPTION', sourceRefs: [] });
      }
    }
    const scopeIntent = USER_FIELD_PATTERNS.reduce((text, [, expression]) => text.replace(expression, ''), intent).replace(/[，,。；;\s]+$/g, '');
    const vagueScope = /^(?:我)?(?:想|打算|希望|要|准备)?(?:开始)?(?:创业|开店|做生意)(?:[，,]?帮我(?:分析|评估|规划))?[。！!？?\s]*$/.test(scopeIntent)
      || /^(?:请|帮我|给我)?(?:做|生成|写)?(?:一份)?(?:创业|开店)(?:商业)?(?:报告|评估|计划|评估报告)[。！!？?\s]*$/.test(scopeIntent);
    // A specific report can proceed with disclosed scenarios; budget and deadline are not mandatory guesses.
    const questions: GoalBrief['readiness']['questions'] = vagueScope
      ? [{ key: 'goal', question: '你想做哪类项目，先评估可行性还是制定实施计划？' }] : [];
    return goalBriefSchema.parse({
      schemaVersion: 'goal-brief.v1', goalId: input.goalId, version, statement: intent,
      domain: input.understanding?.domain ?? (scopeChanged ? null : previous?.domain) ?? null,
      lifecycle: input.understanding?.lifecycle ?? null,
      outcomeKind: report ? 'REPORT' : input.understanding?.lifecycle === 'PERSISTENT' ? 'PLAN'
        : input.understanding?.lifecycle === 'USER_EVENT' || input.understanding?.capabilities.some(item => item.key.endsWith('.create')) ? 'ACTION' : 'UNSPECIFIED',
      ...(report || inheritSubject ? { reportSubject: carWashBusiness
        ? { kind: 'CAR_WASH_BUSINESS', sourceRefs: [{ kind: 'USER_MESSAGE', id: input.messageId, quote: intent }] }
        : inheritSubject ? structuredClone(inheritSubject) : { kind: 'GENERAL', sourceRefs: [{ kind: 'USER_MESSAGE', id: input.messageId, quote: intent }] } } : {}),
      fields: [...fields.values()], readiness: { state: questions.length ? 'NEEDS_CLARIFICATION' : 'READY_FOR_PROPOSAL',
        reasonCodes: questions.length ? ['GOAL_SCOPE_UNSPECIFIED'] : [], questions, executionAuthorized: false },
      createdAt: new Date().toISOString(), executionAuthorized: false,
    });
  }

  reference(brief: GoalBrief): GoalBriefRef {
    const parsed = goalBriefSchema.parse(brief);
    return { goalId: parsed.goalId, version: parsed.version, contentHash: catalogHash(parsed) };
  }

  reportDelivery(brief: GoalBrief): DeliverySpec | undefined {
    if (brief.outcomeKind !== 'REPORT' || brief.readiness.state !== 'READY_FOR_PROPOSAL') return undefined;
    return deliverySpecSchema.parse({ schemaVersion: 'delivery-spec.v1', kind: 'REPORT', goalBriefRef: this.reference(brief),
      title: brief.statement.slice(0, 200), sections: ['需求与范围', '分析与依据', '方案与建议', '风险与待核实事项'],
      acceptance: ['REPORT_SECTIONS', 'SOURCE_PROVENANCE', 'ASSUMPTIONS_DISCLOSED', 'USER_REVIEW'],
      limitations: ['用户未提供或尚未验证的数字作为明确情景假设，不能写成已核实事实。'], executionAuthorized: false });
  }
}

// Values are exact message excerpts: no geocoding, inferred budget, or permanent facts.
const USER_FIELD_PATTERNS: Array<[FieldKey, RegExp]> = [
  ['budget', /(?:预算|投资额|投入资金|启动资金|总投入上限|总投入)(?:改为|改成|改到|改|调整为|调整到|更新为|变为|变成|为|是|约|：|:|\s)*(?:人民币|[￥¥])?\d[\d,.，]*\s*(?:万|千|百)?(?:元|人民币)?|(?:人民币|[￥¥])?\d[\d,.，]*\s*(?:万|千|百)?(?:元|人民币)?\s*(?:的)?预算/],
  ['location', /(?:在|位于|地点[为是：:\s]*|城市[为是：:\s]*|地区[为是：:\s]*)[\u4e00-\u9fff]{2,12}?(?=开|做|创业|经营|的|[，,。；;\s]|$)|(?:湖北)?荆门(?:城区)?(?=开|做|创业|经营|的|[，,。；;\s]|$)/],
  ['timeframe', /(?:计划|希望|要求)?(?:在)?(?:\d+\s*(?:天|周|个月|月|年)(?:内|后)|(?:明天|后天|下周|下个月|今年|明年)|每天\s*\d{1,2}(?::\d{2}|点)(?:\d{1,2}分)?)/],
  ['successCriteria', /(?:成功标准|目标收入|月收入|每月收入|目标利润)[为是约：:\s]*[\d,.，]+\s*(?:万|千|百)?(?:元)?/],
  ['riskPreference', /(?:风险偏好|风险承受能力|风险承受|风险)[为是：:\s]*(?:低|中|高)|(?:保守型|稳健型|激进型)/],
];
