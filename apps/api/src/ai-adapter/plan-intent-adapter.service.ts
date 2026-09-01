import { BadRequestException, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import { getPlanTemplateByKey, resolvePlanTemplate } from '../templates/template-registry';

type TemplateKey =
  | 'monthly-bill-summary'
  | 'mobile-bill-guard'
  | 'quiet-delivery-guard'
  | 'family-supply-reminder'
  | 'video-multi-platform'
  | 'daily-important-summary'
  | 'exam-study-plan'
  | 'device-consumable-reminder';

interface PlanIntentCandidate {
  templateKey: TemplateKey;
  score: number;
  reason: string;
  config: Record<string, unknown>;
  matchedKeywords: string[];
}

interface ParsedPlanIntent {
  input: string;
  templateKey: TemplateKey;
  reason: string;
  config: Record<string, unknown>;
  matchedKeywords: string[];
}

export interface GeneratedPlanDraft {
  input: string;
  adapter: 'deterministic_fallback';
  template: {
    key: TemplateKey;
    name: string;
    description: string;
    icon: string;
  };
  reason: string;
  config: Record<string, unknown>;
  humanSummary: string;
  canInstallDirectly: boolean;
  missingFields: Array<{ key: string; label: string }>;
  matchedKeywords: string[];
}

const TEMPLATE_ESSENTIAL_FIELDS: Readonly<Record<TemplateKey, string[]>> = Object.freeze({
  'monthly-bill-summary': [],
  'mobile-bill-guard': [],
  'quiet-delivery-guard': ['trackingNumber'],
  'family-supply-reminder': ['itemName', 'lastPurchasedAt', 'estimatedUsageDays'],
  'video-multi-platform': ['masterContentId', 'targetPlatforms'],
  'daily-important-summary': [],
  'exam-study-plan': ['examName', 'examDate', 'subjects'],
  'device-consumable-reminder': ['deviceProfileId', 'consumableId'],
});

const SUPPLY_ITEMS = ['纸巾', '洗衣液', '猫粮', '狗粮', '咖啡豆', '饮用水', '垃圾袋', '湿巾', '抽纸', '卫生纸'];
const STUDY_SUBJECT_SPLIT = /[,\n，、]/;

@Injectable()
export class PlanIntentAdapterService {
  parsePlanIntent(query: string): ParsedPlanIntent {
    const trimmed = query.trim();
    if (!trimmed) throw new BadRequestException('请先说出你想偷什么懒。');
    const normalized = normalizeText(trimmed);
    const candidates = [
      this.buildMobileBillGuardIntent(trimmed, normalized),
      this.buildMonthlyBillSummaryIntent(trimmed, normalized),
      this.buildDeliveryIntent(trimmed, normalized),
      this.buildHouseholdIntent(trimmed, normalized),
      this.buildContentIntent(trimmed, normalized),
      this.buildDailySummaryIntent(trimmed, normalized),
      this.buildStudyIntent(trimmed, normalized),
      this.buildDeviceIntent(trimmed, normalized),
    ].filter((candidate): candidate is PlanIntentCandidate => candidate !== null);
    const winner = candidates.sort((left, right) => right.score - left.score)[0];
    if (!winner || winner.score <= 0) {
      throw new BadRequestException('暂时还没识别出最适合的计划，请把场景、条件和你想要的结果说得更具体一点。');
    }
    return {
      input: trimmed,
      templateKey: winner.templateKey,
      reason: winner.reason,
      config: winner.config,
      matchedKeywords: winner.matchedKeywords,
    };
  }

  generatePlanDraft(query: string): GeneratedPlanDraft {
    const intent = this.parsePlanIntent(query);
    const template = getPlanTemplateByKey(intent.templateKey);
    if (!template) throw new BadRequestException('匹配到了模板类型，但模板目录暂时不可用。');
    let resolvedConfig = { ...intent.config };
    const missingKeys = new Set<string>();
    try {
      const resolved = resolvePlanTemplate(intent.templateKey, intent.config);
      if (resolved) resolvedConfig = resolved.metadata.templateConfig;
    } catch (error) {
      if (error instanceof ZodError) {
        for (const issue of error.issues) {
          const key = issue.path[0];
          if (typeof key === 'string') missingKeys.add(key);
        }
      } else {
        throw error;
      }
    }
    for (const key of TEMPLATE_ESSENTIAL_FIELDS[intent.templateKey]) {
      if (!hasMeaningfulValue(intent.config[key])) missingKeys.add(key);
    }
    const missingFields = template.configFields
      .filter((field) => missingKeys.has(field.key))
      .map((field) => ({ key: field.key, label: field.label }));
    const canInstallDirectly = missingFields.length === 0;
    return {
      input: intent.input,
      adapter: 'deterministic_fallback',
      template: {
        key: template.key as TemplateKey,
        name: template.name,
        description: template.description,
        icon: template.icon,
      },
      reason: intent.reason,
      config: resolvedConfig,
      humanSummary: canInstallDirectly
        ? `我会先按“${template.name}”为你生成一份可继续编辑的计划草稿。`
        : `我先帮你识别成“${template.name}”，但还差 ${missingFields.map((field) => field.label).join('、')}，补充后就能生成草稿。`,
      canInstallDirectly,
      missingFields,
      matchedKeywords: intent.matchedKeywords,
    };
  }

  private buildMobileBillGuardIntent(query: string, normalized: string): PlanIntentCandidate | null {
    const matchedKeywords = collectMatchedKeywords(normalized, ['话费', '流量费', '电话费', '手机费']);
    if (matchedKeywords.length === 0) return null;
    const monthlyThreshold = extractMoney(query) ?? 150;
    const increase = extractPercent(query) ?? 30;
    const checkDay = extractDayOfMonth(query) ?? 5;
    return {
      templateKey: 'mobile-bill-guard',
      score: 12 + matchedKeywords.length,
      reason: `识别到“${matchedKeywords.join('、')}”和“超过阈值再提醒”的表达，更像是话费异常守护。`,
      matchedKeywords,
      config: {
        planName: '话费异常守护',
        monthlyThreshold,
        percentIncreaseThreshold: increase,
        sourceType: 'manual',
        onlyAbnormalNotify: true,
        checkDayOfMonth: checkDay,
      },
    };
  }

  private buildMonthlyBillSummaryIntent(query: string, normalized: string): PlanIntentCandidate | null {
    const matchedKeywords = collectMatchedKeywords(normalized, ['账单汇总', '月度账单', '月报', '账单月报']);
    if (matchedKeywords.length === 0) return null;
    return {
      templateKey: 'monthly-bill-summary',
      score: 10 + matchedKeywords.length,
      reason: '你更像是在要一份按月生成的账单汇总，而不是超额告警。',
      matchedKeywords,
      config: {
        planName: '月度账单汇总',
        summaryDay: extractDayOfMonth(query) ?? 1,
        sourceType: 'manual',
        billingPeriod: normalized.includes('上月') ? 'previous_month' : 'current_month',
        showCategories: true,
        showMonthOverMonth: true,
        anomalyThresholdPercent: extractPercent(query) ?? 20,
        notificationPreference: normalized.includes('提醒') ? 'summary' : 'silent',
      },
    };
  }

  private buildDeliveryIntent(query: string, normalized: string): PlanIntentCandidate | null {
    const matchedKeywords = collectMatchedKeywords(normalized, ['快递', '物流', '运单', '没动静', '签收']);
    if (matchedKeywords.length === 0) return null;
    const trackingNumber = extractTrackingNumber(query);
    const extractedHours = extractHours(query);
    const extractedDays = extractDays(query)?.value;
    return {
      templateKey: 'quiet-delivery-guard',
      score: 11 + matchedKeywords.length + (trackingNumber ? 2 : 0),
      reason: '识别到你想盯住某个快递是否长时间没有进展。',
      matchedKeywords,
      config: {
        planName: '快递静默管家',
        trackingNumber,
        carrier: detectCarrier(normalized),
        staleHours: extractedHours ?? (extractedDays ? extractedDays * 24 : 48),
        notifyOnException: true,
        notifyOnDelivered: normalized.includes('签收'),
        checkInterval: detectDeliveryCheckInterval(query),
      },
    };
  }

  private buildHouseholdIntent(query: string, normalized: string): PlanIntentCandidate | null {
    const matchedKeywords = collectMatchedKeywords(normalized, ['补货', '囤货', '用品', ...SUPPLY_ITEMS]);
    if (matchedKeywords.length === 0) return null;
    const itemName = extractSupplyItem(query, normalized);
    const usageDays = extractDays(query)?.value;
    const remindBeforeDays = extractLeadDays(query) ?? 7;
    return {
      templateKey: 'family-supply-reminder',
      score: 9 + matchedKeywords.length + (itemName ? 2 : 0),
      reason: '你更像是在描述家里用品的消耗周期和补货提醒。',
      matchedKeywords,
      config: {
        planName: itemName ? `${itemName}补货提醒` : '家庭补给提醒',
        itemName,
        category: normalized.includes('滤芯') ? '滤芯耗材' : '日用补给',
        lastPurchasedAt: extractDate(query) ?? undefined,
        purchaseQuantity: 1,
        estimatedUsageDays: usageDays,
        remindBeforeDays,
        preparationMode: normalized.includes('清单') || normalized.includes('准备好') ? 'shopping_list' : 'reminder',
      },
    };
  }

  private buildContentIntent(query: string, normalized: string): PlanIntentCandidate | null {
    const matchedKeywords = collectMatchedKeywords(normalized, ['一稿多发', '多平台', '抖音', 'b站', '视频']);
    if (matchedKeywords.length === 0) return null;
    const targetPlatforms = [
      normalized.includes('抖音') ? 'douyin' : null,
      normalized.includes('b站') || normalized.includes('哔哩') ? 'bilibili' : null,
    ].filter((item): item is 'douyin' | 'bilibili' => Boolean(item));
    return {
      templateKey: 'video-multi-platform',
      score: 9 + matchedKeywords.length + targetPlatforms.length,
      reason: '识别到你想把同一份内容整理成多个平台版本。',
      matchedKeywords,
      config: {
        planName: '视频一稿多发',
        targetPlatforms,
        generateTitle: true,
        generateDescription: true,
        generateTags: true,
        prepareCover: true,
        requireApprovalBeforePublish: true,
        notificationPreference: 'summary',
      },
    };
  }

  private buildDailySummaryIntent(query: string, normalized: string): PlanIntentCandidate | null {
    const matchedKeywords = collectMatchedKeywords(normalized, ['重要事项', '摘要', '汇总', '每天', '今天要做']);
    if (matchedKeywords.length === 0) return null;
    const time = extractTime(query) ?? '07:30';
    const includedSources = [
      'internal_task',
      'manual_event',
      ...(normalized.includes('邮件') ? ['test_email'] : []),
      ...(normalized.includes('日历') ? ['test_calendar'] : []),
    ];
    return {
      templateKey: 'daily-important-summary',
      score: 8 + matchedKeywords.length,
      reason: '你更像是在要一份固定时间生成的重点事项摘要。',
      matchedKeywords,
      config: {
        planName: '每日重要事项摘要',
        summaryTime: time,
        includedSources: dedupeList(includedSources),
        lookAheadHours: extractHours(query) ?? 24,
        includeCalendar: normalized.includes('日历') || normalized.includes('会议'),
        includeMessages: normalized.includes('邮件') || normalized.includes('消息'),
        maxItems: extractLimitedNumber(query, 20) ?? 5,
        notificationPreference: normalized.includes('重要提醒') ? 'important' : 'summary',
      },
    };
  }

  private buildStudyIntent(query: string, normalized: string): PlanIntentCandidate | null {
    const matchedKeywords = collectMatchedKeywords(normalized, ['考试', '备考', '复习', '学习计划', '刷题']);
    if (matchedKeywords.length === 0) return null;
    const subjects = extractSubjects(query);
    return {
      templateKey: 'exam-study-plan',
      score: 10 + matchedKeywords.length + (subjects.length > 0 ? 2 : 0),
      reason: '识别到你想围绕一场考试按天生成学习任务和复盘安排。',
      matchedKeywords,
      config: {
        planName: '考试学习计划',
        examName: extractExamName(query),
        examDate: extractDate(query) ?? undefined,
        subjects: subjects.length > 0 ? subjects.join('，') : undefined,
        dailyStudyMinutes: extractMinutes(query) ?? 60,
        preferredStudyTime: extractTime(query) ?? '20:00',
        target: extractTarget(query) ?? '按计划完成备考',
        currentProgress: extractProgress(query) ?? 0,
        weeklySummaryDay: detectWeekday(query) ?? 'sunday',
        missedTaskStrategy: normalized.includes('重排') ? 'rebalance_future' : 'catch_up_today',
      },
    };
  }

  private buildDeviceIntent(query: string, normalized: string): PlanIntentCandidate | null {
    const matchedKeywords = collectMatchedKeywords(normalized, ['设备', '耗材', '滤芯', '净水器', '更换提醒', '维护']);
    if (matchedKeywords.length === 0) return null;
    return {
      templateKey: 'device-consumable-reminder',
      score: 10 + matchedKeywords.length,
      reason: '识别到你想跟踪设备耗材的更换周期，并在临近时提醒或准备购买清单。',
      matchedKeywords,
      config: {
        planName: '设备耗材提醒',
        preparationMode: normalized.includes('清单') || normalized.includes('准备') ? 'shopping_list' : 'reminder',
        notificationPreference: normalized.includes('重要提醒') ? 'important' : 'summary',
      },
    };
  }
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function collectMatchedKeywords(normalized: string, keywords: string[]) {
  return keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
}

function hasMeaningfulValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
}

function extractMoney(query: string) {
  return extractNumber(query, /(?:超过|超出|高于|大于|到|满)?\s*(\d+(?:\.\d+)?)\s*(?:元|块)/);
}

function extractPercent(query: string) {
  return extractNumber(query, /(\d+(?:\.\d+)?)\s*%/);
}

function extractDayOfMonth(query: string) {
  const value = extractNumber(query, /每月\s*(\d{1,2})\s*[号日]/);
  return value ? Math.max(1, Math.min(28, Math.round(value))) : null;
}

function extractHours(query: string) {
  const value = extractNumber(query, /(\d{1,3})\s*(?:小时|h|H)/);
  return value ? Math.max(1, Math.round(value)) : null;
}

function extractDays(query: string) {
  const match = query.match(/(\d{1,4})\s*天/);
  if (!match) return null;
  return { value: Math.max(1, Number(match[1])) };
}

function extractLeadDays(query: string) {
  const value = extractNumber(query, /提前\s*(\d{1,4})\s*天/);
  return value ? Math.max(0, Math.round(value)) : null;
}

function extractMinutes(query: string) {
  const value = extractNumber(query, /(\d{1,4})\s*分钟/);
  return value ? Math.max(15, Math.round(value)) : null;
}

function extractProgress(query: string) {
  const value = extractNumber(query, /(?:进度|已完成)\s*(\d{1,3})\s*%/);
  return value ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

function extractTrackingNumber(query: string) {
  const match = query.match(/\b[A-Za-z0-9]{8,24}\b/);
  return match?.[0] ?? undefined;
}

function extractSupplyItem(query: string, normalized: string) {
  const quoted = query.match(/[“"](.*?)[”"]/);
  if (quoted?.[1]) return quoted[1].trim();
  return SUPPLY_ITEMS.find((item) => normalized.includes(item)) ?? undefined;
}

function extractDate(query: string) {
  const match = query.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractTime(query: string) {
  const match = query.match(/(早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:[:点](\d{1,2}))?/);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3] ?? '0');
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) return null;
  const period = match[1] ?? '';
  if ((period === '下午' || period === '晚上') && hour < 12) hour += 12;
  if (period === '中午' && hour < 11) hour += 12;
  return `${String(Math.min(hour, 23)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function extractExamName(query: string) {
  const match = query.match(/(?:备考|考试|考)\s*([^，。；,]{2,30})/);
  return match?.[1]?.trim() ?? '我的考试';
}

function extractSubjects(query: string) {
  const match = query.match(/(?:科目|包括|复习)\s*[:：]?\s*([^。；;]+)/);
  if (!match?.[1]) return [];
  return dedupeList(match[1].split(STUDY_SUBJECT_SPLIT).map((item) => item.trim()).filter(Boolean)).slice(0, 20);
}

function extractTarget(query: string) {
  const match = query.match(/(?:目标|希望|想要)\s*[:：]?\s*([^。；;]+)/);
  return match?.[1]?.trim() ?? null;
}

function detectWeekday(query: string) {
  if (query.includes('周一') || query.includes('星期一')) return 'monday';
  if (query.includes('周二') || query.includes('星期二')) return 'tuesday';
  if (query.includes('周三') || query.includes('星期三')) return 'wednesday';
  if (query.includes('周四') || query.includes('星期四')) return 'thursday';
  if (query.includes('周五') || query.includes('星期五')) return 'friday';
  if (query.includes('周六') || query.includes('星期六')) return 'saturday';
  if (query.includes('周日') || query.includes('周天') || query.includes('星期日') || query.includes('星期天')) return 'sunday';
  return null;
}

function detectCarrier(normalized: string) {
  if (normalized.includes('顺丰')) return 'sf';
  if (normalized.includes('京东')) return 'jd';
  if (normalized.includes('圆通')) return 'yto';
  if (normalized.includes('中通')) return 'zto';
  if (normalized.includes('申通')) return 'sto';
  if (normalized.includes('韵达')) return 'yunda';
  if (normalized.includes('ems')) return 'ems';
  return 'auto';
}

function detectDeliveryCheckInterval(query: string): '6h' | '12h' | '24h' {
  const hours = extractHours(query) ?? 24;
  if (hours <= 6) return '6h';
  if (hours <= 12) return '12h';
  return '24h';
}

function extractLimitedNumber(query: string, max: number) {
  const value = extractNumber(query, /(?:最多|只看|展示)\s*(\d{1,3})\s*(?:项|条)?/);
  return value ? Math.max(1, Math.min(max, Math.round(value))) : null;
}

function extractNumber(query: string, pattern: RegExp) {
  const match = query.match(pattern);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function dedupeList<T>(values: T[]) {
  return [...new Set(values)];
}
